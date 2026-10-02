import { createError, defineEventHandler, readBody } from 'h3'
import { getEnv } from '../../../../utils/env'
import { requireAccountUserContext } from '../../../../utils/account'
import { isEmailEnabled } from '../../../../utils/email'
import { normalizeEmail, sendEmailChangeConfirmation } from '../../../../utils/email-flows'
import { findGlobalAccountByEmail } from '../../../../utils/identity'
import { requireRecentAuth } from '../../../../utils/sign-in-methods'
import { consumeRateLimit } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/account/email/change { new_email } — needs a recent sign-in, then mails a
 * confirmation link to the NEW address; the email changes only when that link is opened.
 */
export default defineEventHandler(async (event) => {
  if (!isEmailEnabled(getEnv(event))) throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured' })
  const ctx = await requireAccountUserContext(event)
  const account = ctx.globalAccount
  if (!account) throw createError({ statusCode: 400, statusMessage: 'Account is not bound to a global account' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { new_email?: string }
  const newEmail = normalizeEmail(body.new_email)
  if (newEmail === account.email.toLowerCase()) throw createError({ statusCode: 400, statusMessage: 'This is already your email' })
  await requireRecentAuth(event, ctx)
  if (await findGlobalAccountByEmail(event, newEmail)) throw createError({ statusCode: 409, statusMessage: 'Email already in use' })
  await consumeRateLimit(event, 'email_change', account.id, 5, 3600)
  await sendEmailChangeConfirmation(event, account.id, newEmail)
  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.email.change_requested',
    payload: { global_account_id: account.id },
  })
  return { ok: true, sent_to: newEmail }
})
