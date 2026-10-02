import { createError, defineEventHandler, readBody } from 'h3'
import { getEnv } from '../../../../utils/env'
import { getIssuer } from '../../../../utils/auth'
import { issueEmailToken } from '../../../../utils/account-email'
import { actionEmail, isEmailEnabled, sendEmail } from '../../../../utils/email'
import { ensureGlobalIdentitySchema, findGlobalAccountByEmail } from '../../../../utils/identity'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/auth/password/forgot { email, client_id? } — mails a 30-minute reset link.
 * Always answers { ok: true } so the response never reveals whether an account exists.
 */
export default defineEventHandler(async (event) => {
  const env = getEnv(event)
  if (!isEmailEnabled(env)) throw createError({ statusCode: 503, statusMessage: 'Password reset is not available' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { email?: string; client_id?: string }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) throw createError({ statusCode: 400, statusMessage: 'email required' })

  await consumeRateLimit(event, 'password_forgot_ip', requestIp(event), 20, 3600)
  await consumeRateLimit(event, 'password_forgot_email', email, 3, 3600)

  await ensureGlobalIdentitySchema(event)
  const account = await findGlobalAccountByEmail(event, email)
  if (account && account.status === 'active') {
    const token = await issueEmailToken(event, account.id, 'reset_password')
    const link = new URL('/reset-password', getIssuer(event, env))
    link.searchParams.set('token', token)
    if (typeof body.client_id === 'string' && body.client_id.trim()) link.searchParams.set('client_id', body.client_id.trim())
    await sendEmail(
      event,
      actionEmail({
        to: account.email,
        subject: '重置你的 leeguoo 账号密码 / Reset your password',
        intro: '有人（希望是你）请求重置这个账号的密码。点击下面的按钮设置新密码，链接 30 分钟内有效。 Someone asked to reset the password of this account.',
        action: '设置新密码 / Set a new password',
        url: link.toString(),
        outro: '如果不是你本人操作，忽略这封邮件即可，密码不会改变。 If this was not you, ignore this email.',
      }),
    )
    await writeAuditLog(event, { tenantId: null, userId: null, action: 'account.password.reset_requested', payload: { global_account_id: account.id } })
  }
  return { ok: true }
})
