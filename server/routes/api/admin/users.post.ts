import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { writeAuditLog } from '../../../utils/audit'

type Body = { tenant_id?: string; action?: 'disable' | 'enable' | 'revoke_sessions'; user_id?: string }

/**
 * POST /api/admin/users { tenant_id, action, user_id } — disable / enable a tenant user, or sign
 * them out everywhere. Disabling also revokes their sessions, so it takes effect immediately.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Body
  const tenantId = String(body.tenant_id || '').trim()
  const principal = await requireTenantAdmin(event, tenantId)
  const userId = String(body.user_id || '').trim()
  const action = body.action
  if (!userId || !action || !['disable', 'enable', 'revoke_sessions'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: 'user_id and a valid action are required' })
  }
  if (userId === principal.sub && action !== 'revoke_sessions') {
    throw createError({ statusCode: 400, statusMessage: 'You cannot disable your own account' })
  }

  const db = getDb(event)
  const user = await db.prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`).bind(userId, tenantId).first<{ id: string }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found in tenant' })

  const revoke = db
    .prepare(`UPDATE sessions SET revoked_at = strftime('%s', 'now') WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(userId)
  if (action === 'disable') {
    await db.batch([db.prepare(`UPDATE users SET status = 'disabled', updated_at = strftime('%s', 'now') WHERE id = ?`).bind(userId), revoke])
  } else if (action === 'enable') {
    await db.prepare(`UPDATE users SET status = 'active', updated_at = strftime('%s', 'now') WHERE id = ?`).bind(userId).run()
  } else {
    await revoke.run()
  }

  await writeAuditLog(event, { tenantId, userId: principal.sub, action: `admin.user.${action}`, payload: { target_user_id: userId } })
  return { ok: true }
})
