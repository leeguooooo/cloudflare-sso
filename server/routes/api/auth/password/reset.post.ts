import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../../utils/env'
import { consumeEmailToken, markEmailVerified } from '../../../../utils/account-email'
import { hashAccountPassword } from '../../../../utils/password'
import { clearLoginFailures } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/auth/password/reset { token, password } — sets a new password from a reset link.
 * The link proves the user controls the inbox, so the email also counts as verified; every
 * existing session is revoked (whoever knew the old password is signed out everywhere).
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { token?: string; password?: string }
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })

  const token = await consumeEmailToken(event, typeof body.token === 'string' ? body.token : '', ['reset_password'])
  if (!token) throw createError({ statusCode: 400, statusMessage: 'invalid_or_expired_token' })

  const db = getDb(event)
  const env = getEnv(event)
  const account = await db
    .prepare(`SELECT id, email, status FROM global_accounts WHERE id = ?`)
    .bind(token.global_account_id)
    .first<{ id: string; email: string; status: string }>()
  if (!account || account.status !== 'active') throw createError({ statusCode: 400, statusMessage: 'invalid_or_expired_token' })

  const hash = await hashAccountPassword(env, password)
  await db.batch([
    db.prepare(`UPDATE global_accounts SET password_hash = ?, password_set = 1, updated_at = strftime('%s', 'now') WHERE id = ?`).bind(hash, account.id),
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = strftime('%s', 'now') WHERE global_account_id = ?`).bind(hash, account.id),
    db
      .prepare(
        `UPDATE sessions SET revoked_at = strftime('%s', 'now')
         WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE global_account_id = ?)`,
      )
      .bind(account.id),
  ])
  await markEmailVerified(event, account.id)
  await clearLoginFailures(event, account.email.toLowerCase())
  await writeAuditLog(event, { tenantId: null, userId: null, action: 'account.password.reset', payload: { global_account_id: account.id } })
  return { ok: true, email: account.email }
})
