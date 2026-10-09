import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'

const MAX_ROWS = 50000

/** Spreadsheet-safe CSV cell: quoted, and formulas neutralised (=, +, -, @ would run in Excel). */
export const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

const iso = (seconds: number | null) => (seconds ? new Date(Number(seconds) * 1000).toISOString() : '')

/**
 * GET /api/admin/users/export?tenant_id= — every user of the tenant as CSV (id = the app's
 * `sub`, email, status, roles, created, last sign-in, global account id). Up to 50k rows.
 * Tenant admins; each export is audited.
 */
export default defineEventHandler(async (event) => {
  const tenantId = String(getQuery(event).tenant_id || '')
  const principal = await requireTenantAdmin(event, tenantId)
  const rows =
    (
      await getDb(event)
        .prepare(
          `SELECT u.id, u.email, u.status, u.global_account_id, u.created_at,
             (SELECT group_concat(r.name, ' ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
             (SELECT max(max(s.created_at, COALESCE(s.rotated_at, 0))) FROM sessions s WHERE s.user_id = u.id) AS last_active
           FROM users u WHERE u.tenant_id = ? ORDER BY u.created_at LIMIT ?`,
        )
        .bind(tenantId, MAX_ROWS)
        .all<{ id: string; email: string; status: string; global_account_id: string | null; created_at: number; roles: string | null; last_active: number | null }>()
    ).results || []

  const header = ['user_id', 'email', 'status', 'roles', 'created_at', 'last_active_at', 'global_account_id']
  const lines = [header.join(',')].concat(
    rows.map((r) =>
      [r.id, r.email, r.status, [...new Set((r.roles || '').split(' ').filter(Boolean))].join(' '), iso(r.created_at), iso(r.last_active), r.global_account_id].map(csvCell).join(','),
    ),
  )
  await writeAuditLog(event, { tenantId, userId: principal.sub, action: 'admin.users.export', payload: { rows: rows.length } })
  setResponseHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'content-disposition', `attachment; filename="users-${tenantId}-${new Date().toISOString().slice(0, 10)}.csv"`)
  setResponseHeader(event, 'cache-control', 'no-store')
  // BOM so Excel opens UTF-8 (Chinese names, emails) correctly.
  return `﻿${lines.join('\r\n')}\r\n`
})
