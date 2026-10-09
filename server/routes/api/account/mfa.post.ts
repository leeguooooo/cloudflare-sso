import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { requireRecentAuth } from '../../../utils/sign-in-methods'
import { writeAuditLog } from '../../../utils/audit'
import { getDb } from '../../../utils/env'
import { otpauthUri } from '../../../utils/totp'
import {
  confirmTotpEnrollment,
  disableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  startTotpEnrollment,
  verifySecondFactor,
} from '../../../utils/mfa'

type Action = 'start' | 'confirm' | 'regenerate_recovery_codes' | 'disable'
const ACTIONS: readonly Action[] = ['start', 'confirm', 'regenerate_recovery_codes', 'disable']

/**
 * POST /api/account/mfa { action, code? } — manage two-step verification. Every action needs a
 * sign-in within the last 15 minutes (`403 reauth_required` otherwise).
 * - `start` → { secret, otpauth_uri }: a new authenticator secret, pending until confirmed
 * - `confirm { code }` → { recovery_codes }: turns it on; the codes are shown only this once
 * - `regenerate_recovery_codes { code }` → { recovery_codes }: replaces all recovery codes
 * - `disable { code }`: turns it off (authenticator or recovery code)
 * It protects email + password sign-in, so the account needs a password first.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const gaid = ctx.globalAccount?.id
  if (!gaid) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { action?: Action; code?: string }
  if (!body.action || !ACTIONS.includes(body.action)) {
    throw createError({ statusCode: 400, statusMessage: `action must be one of: ${ACTIONS.join(', ')}` })
  }
  await requireRecentAuth(event, ctx)
  setResponseHeader(event, 'cache-control', 'no-store')
  const code = String(body.code || '').trim()
  const audit = (action: string) =>
    writeAuditLog(event, { tenantId: ctx.user.tenant_id, userId: ctx.user.id, action: `account.mfa.${action}`, payload: {} })

  if (body.action === 'start') {
    const account = await getDb(event).prepare(`SELECT password_set FROM global_accounts WHERE id = ?`).bind(gaid).first<{ password_set: number | null }>()
    if (account?.password_set === 0) throw createError({ statusCode: 400, statusMessage: 'password_required' })
    const secret = await startTotpEnrollment(event, gaid)
    return { secret, otpauth_uri: otpauthUri(secret, ctx.globalAccount!.email, 'leeguoo') }
  }

  if (body.action === 'confirm') {
    if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })
    const recoveryCodes = await confirmTotpEnrollment(event, gaid, code)
    await audit('enable')
    return { recovery_codes: recoveryCodes, status: await getMfaStatus(event, gaid) }
  }

  // Changing an enabled setup needs a current second factor, not just a recent session.
  if (!code || !(await verifySecondFactor(event, gaid, code))) throw createError({ statusCode: 400, statusMessage: 'invalid_code' })

  if (body.action === 'regenerate_recovery_codes') {
    const recoveryCodes = await regenerateRecoveryCodes(event, gaid)
    await audit('regenerate_recovery_codes')
    return { recovery_codes: recoveryCodes, status: await getMfaStatus(event, gaid) }
  }

  await disableMfa(event, gaid)
  await audit('disable')
  return { status: await getMfaStatus(event, gaid) }
})
