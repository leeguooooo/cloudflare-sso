import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'

/** GET /api/admin/users?tenant_id=&q=&limit= — the tenant's users, newest first, with roles and session stats. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  const q = String(query.q || '').trim().toLowerCase()
  const limitRaw = Number(query.limit || 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50

  const rows = await getDb(event)
    .prepare(
      `SELECT
         u.id, u.email, u.status, u.global_account_id, u.created_at,
         (SELECT group_concat(r.name, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
         (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in_at,
         (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > strftime('%s', 'now')) AS active_sessions
       FROM users u
       WHERE u.tenant_id = ? AND (? = '' OR u.normalized_email LIKE ? OR u.id = ?)
       ORDER BY u.created_at DESC
       LIMIT ?`,
    )
    .bind(tenantId, q, `%${q}%`, q, limit)
    .all<{ id: string; email: string; status: string; global_account_id: string | null; created_at: number; roles: string | null; last_sign_in_at: number | null; active_sessions: number }>()

  return {
    users: (rows.results || []).map((row) => ({
      ...row,
      roles: row.roles ? [...new Set(row.roles.split(','))] : [],
      last_sign_in_at: row.last_sign_in_at ? Number(row.last_sign_in_at) : null,
      active_sessions: Number(row.active_sessions || 0),
    })),
  }
})
