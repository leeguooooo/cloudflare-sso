import { createError, defineEventHandler } from 'h3'
import { getEnv } from '../../../../utils/env'
import { requireAccountUserContext } from '../../../../utils/account'
import { isEmailEnabled } from '../../../../utils/email'
import { sendVerificationEmail } from '../../../../utils/email-flows'
import { accountEmailVerified } from '../../../../utils/oauth-complete'
import { consumeRateLimit } from '../../../../utils/rate-limit'

/** POST /api/account/email/verify — mails a verification link to the account's current email. */
export default defineEventHandler(async (event) => {
  if (!isEmailEnabled(getEnv(event))) throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured' })
  const ctx = await requireAccountUserContext(event)
  const account = ctx.globalAccount
  if (!account) throw createError({ statusCode: 400, statusMessage: 'Account is not bound to a global account' })
  if (account.email.toLowerCase().endsWith('.invalid')) {
    throw createError({ statusCode: 400, statusMessage: 'This account has no deliverable email address' })
  }
  if (await accountEmailVerified(event, account.id)) return { ok: true, already_verified: true, sent_to: account.email }
  await consumeRateLimit(event, 'email_verify', account.id, 5, 3600)
  await sendVerificationEmail(event, account.id, account.email)
  return { ok: true, sent_to: account.email }
})
