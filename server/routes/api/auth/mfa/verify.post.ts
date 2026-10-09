import { createError, defineEventHandler, readBody } from 'h3'
import { assertLoginAllowed, recordLoginFailure } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'
import { findGlobalAccountById, getClientByPublicId } from '../../../../utils/identity'
import { getMfaStatus, readMfaChallenge, verifySecondFactor } from '../../../../utils/mfa'
import { completePasswordSignIn } from '../../../../utils/password-login'

/**
 * POST /api/auth/mfa/verify { challenge, code } — second step of a password sign-in for an
 * account with two-step verification. `code` is the authenticator's 6 digits or a recovery
 * code. Success is the same response as /api/auth/login (plus `recovery_codes_remaining`
 * when a recovery code was spent). Wrong codes count against the email's sign-in budget.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { challenge?: string; code?: string }
  const code = String(body.code || '').trim()
  if (!body.challenge || !code) throw createError({ statusCode: 400, statusMessage: 'challenge and code are required' })

  const challenge = await readMfaChallenge(event, String(body.challenge))
  const loginEmail = challenge.email.toLowerCase()
  await assertLoginAllowed(event, loginEmail)

  const client = await getClientByPublicId(event, challenge.clientId)
  const account = await findGlobalAccountById(event, challenge.globalAccountId)
  if (!account) throw createError({ statusCode: 401, statusMessage: 'mfa_challenge_expired' })

  const factor = await verifySecondFactor(event, account.id, code)
  if (!factor) {
    await recordLoginFailure(event, loginEmail)
    await writeAuditLog(event, { tenantId: client.tenant_id, userId: null, action: 'auth.mfa_failed', payload: { client_id: client.client_id, global_account_id: account.id } })
    throw createError({ statusCode: 401, statusMessage: 'invalid_code' })
  }

  const result = await completePasswordSignIn(event, client, account, loginEmail, factor)
  if (factor !== 'recovery') return result
  return { ...result, recovery_codes_remaining: (await getMfaStatus(event, account.id)).recovery_codes_remaining }
})
