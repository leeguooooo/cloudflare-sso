import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'
import { hashPassword, verifyPassword } from '../../../utils/crypto'
import { writeAuditLog } from '../../../utils/audit'

type PasswordBody = {
  current_password?: string
  new_password?: string
}

const validateNewPassword = (password: string) => {
  const value = password.trim()
  if (value.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'new_password must be at least 8 characters' })
  }
  if (value.length > 128) {
    throw createError({ statusCode: 400, statusMessage: 'new_password must be 128 characters or fewer' })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  if (!ctx.globalAccount?.id) {
    throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  }

  const body = (await readBody(event).catch(() => ({}))) as PasswordBody
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : ''
  const newPassword = typeof body.new_password === 'string' ? validateNewPassword(body.new_password) : ''
  if (!currentPassword || !newPassword) {
    throw createError({ statusCode: 400, statusMessage: 'current_password and new_password are required' })
  }
  if (currentPassword === newPassword) {
    throw createError({ statusCode: 400, statusMessage: 'new_password must be different from current_password' })
  }

  const db = getDb(event)
  const account = await db
    .prepare(`SELECT id, password_hash FROM global_accounts WHERE id = ?`)
    .bind(ctx.globalAccount.id)
    .first<{ id: string; password_hash: string }>()
  if (!account?.id) {
    throw createError({ statusCode: 404, statusMessage: 'Global account not found' })
  }

  const env = getEnv(event)
  const verified = await verifyPassword(currentPassword, account.password_hash, env.PASSWORD_PEPPER || '')
  if (!verified) {
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect' })
  }

  const nextHash = await hashPassword(newPassword, env.PASSWORD_PEPPER || '')
  await db
    .prepare(`UPDATE global_accounts SET password_hash = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
    .bind(nextHash, account.id)
    .run()
  await db
    .prepare(`UPDATE users SET password_hash = ?, updated_at = strftime('%s', 'now') WHERE global_account_id = ?`)
    .bind(nextHash, account.id)
    .run()
  await db
    .prepare(
      `UPDATE credentials
       SET secret = ?
       WHERE type = 'password' AND user_id IN (
         SELECT id FROM users WHERE global_account_id = ?
       )`,
    )
    .bind(nextHash, account.id)
    .run()

  const now = Math.floor(Date.now() / 1000)
  if (ctx.currentSessionId) {
    await db
      .prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE user_id IN (SELECT id FROM users WHERE global_account_id = ?)
           AND revoked_at IS NULL
           AND id <> ?`,
      )
      .bind(now, account.id, ctx.currentSessionId)
      .run()
  } else {
    await db
      .prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE user_id IN (SELECT id FROM users WHERE global_account_id = ?)
           AND revoked_at IS NULL`,
      )
      .bind(now, account.id)
      .run()
  }

  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.password.update',
    payload: {
      revoked_other_sessions: true,
      session_id: ctx.currentSessionId || null,
    },
  })

  return {
    ok: true,
    message: 'Password updated successfully',
  }
})
