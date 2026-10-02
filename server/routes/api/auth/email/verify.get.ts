import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { getDb } from '../../../../utils/env'
import { consumeEmailToken, markEmailVerified } from '../../../../utils/account-email'
import { findGlobalAccountByEmail } from '../../../../utils/identity'
import { nowInSeconds } from '../../../../utils/crypto'
import { writeAuditLog } from '../../../../utils/audit'

const back = (params: Record<string, string>) => `/account?${new URLSearchParams({ section: 'profile', ...params })}`

/**
 * GET /api/auth/email/verify?token=… — target of the links in verification and email-change
 * mails. Redirects to the account center with email_verified=1, email_changed=1 or email_error.
 */
export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).token || '')
  const token = await consumeEmailToken(event, raw, ['verify_email', 'change_email'])
  if (!token) return sendRedirect(event, back({ email_error: '链接无效或已过期' }), 302)

  if (token.purpose === 'verify_email') {
    await markEmailVerified(event, token.global_account_id)
    await writeAuditLog(event, { tenantId: null, userId: null, action: 'account.email.verified', payload: { global_account_id: token.global_account_id } })
    return sendRedirect(event, back({ email_verified: '1' }), 302)
  }

  const newEmail = (token.new_email || '').toLowerCase()
  const taken = newEmail ? await findGlobalAccountByEmail(event, newEmail) : null
  if (!newEmail || (taken && taken.id !== token.global_account_id)) {
    return sendRedirect(event, back({ email_error: '该邮箱已被其他账号使用' }), 302)
  }
  const db = getDb(event)
  try {
    await db.batch([
      db
        .prepare(`UPDATE global_accounts SET email = ?, email_verified_at = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
        .bind(newEmail, nowInSeconds(), token.global_account_id),
      db
        .prepare(`UPDATE users SET email = ?, updated_at = strftime('%s', 'now') WHERE global_account_id = ?`)
        .bind(newEmail, token.global_account_id),
    ])
  } catch (error) {
    console.warn('email change failed', { global_account_id: token.global_account_id, error: String(error) })
    return sendRedirect(event, back({ email_error: '该邮箱已被其他账号使用' }), 302)
  }
  await writeAuditLog(event, { tenantId: null, userId: null, action: 'account.email.changed', payload: { global_account_id: token.global_account_id } })
  return sendRedirect(event, back({ email_changed: '1' }), 302)
})
