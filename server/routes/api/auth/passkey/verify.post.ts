import { createError, defineEventHandler, readBody } from 'h3'
import { resolveDefaultClientId } from '../../../../utils/default-client'
import { findGlobalAccountById, getClientByPublicId } from '../../../../utils/identity'
import { verifyPasskeyLogin } from '../../../../utils/passkeys'
import { completePasswordSignIn } from '../../../../utils/password-login'
import { assertLoginAllowed, recordLoginFailure } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'
import { isMfaEnabled, issueMfaChallenge } from '../../../../utils/mfa'

/**
 * POST /api/auth/passkey/verify { challenge_id, client_id?, credential } — signs in with a passkey
 * (the assertion from navigator.credentials.get, binary fields base64url). Same response as
 * /api/auth/login. No two-step challenge when the authenticator verified the user (biometric /
 * PIN); without that, an account with two-step verification gets the same `mfa_required` answer.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { challenge_id?: string; client_id?: string; credential?: Record<string, unknown> }
  if (!body.challenge_id || !body.credential) throw createError({ statusCode: 400, statusMessage: 'challenge_id and credential are required' })
  const credentialId = typeof body.credential.id === 'string' ? body.credential.id : ''
  // Throttled per credential and per IP, like password attempts.
  const throttleKey = `passkey:${credentialId.slice(0, 128)}`
  await assertLoginAllowed(event, throttleKey)
  const client = await getClientByPublicId(event, body.client_id?.trim() || resolveDefaultClientId(event))

  let verified
  try {
    verified = await verifyPasskeyLogin(event, { challengeId: String(body.challenge_id), credential: body.credential })
  } catch (error) {
    await recordLoginFailure(event, throttleKey)
    await writeAuditLog(event, { tenantId: client.tenant_id, userId: null, action: 'auth.passkey_failed', payload: { client_id: client.client_id } })
    throw error
  }
  const account = await findGlobalAccountById(event, verified.globalAccountId)
  if (!account) throw createError({ statusCode: 401, statusMessage: 'passkey_unknown' })
  // Without user verification (no fingerprint / PIN) a passkey is only "something you have":
  // an account with two-step verification still owes its code.
  if (!verified.userVerified && (await isMfaEnabled(event, account.id))) {
    if (account.status !== 'active') throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
    return {
      mfa_required: true,
      challenge: await issueMfaChallenge(event, { globalAccountId: account.id, clientId: client.client_id, email: account.email.toLowerCase() }),
      methods: ['totp', 'recovery'],
    }
  }
  return completePasswordSignIn(event, client, account, account.email.toLowerCase(), 'passkey')
})
