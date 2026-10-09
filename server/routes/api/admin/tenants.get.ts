import { defineEventHandler } from 'h3'
import { getDb } from '../../../utils/env'
import { requireAdminScope } from '../../../utils/admin-console'

/**
 * GET /api/admin/tenants — tenants the caller administers, with user and client counts.
 * Platform admins see every tenant; a tenant admin sees only their own.
 */
export default defineEventHandler(async (event) => {
  const scope = await requireAdminScope(event)
  const rows = await getDb(event)
    .prepare(
      `SELECT
         t.id, t.name, t.domain, t.created_at,
         (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS users,
         (SELECT count(*) FROM clients c WHERE c.tenant_id = t.id) AS clients
       FROM tenants t
       WHERE ? = 1 OR t.id = ?
       ORDER BY t.created_at ASC`,
    )
    .bind(scope.platform ? 1 : 0, scope.principal.tid)
    .all<{ id: string; name: string; domain: string | null; created_at: number; users: number; clients: number }>()

  return {
    platform: scope.platform,
    current_tenant_id: scope.principal.tid,
    tenants: (rows.results || []).map((row) => ({ ...row, users: Number(row.users || 0), clients: Number(row.clients || 0) })),
  }
})
