import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../utils/env'
import { clampLimit, ensureAdminConsoleSchema, parseJsonObject, requireAdminScope, scopedTenantId } from '../../../utils/admin-console'

/**
 * GET /api/admin/audit?tenant_id=&action=&user_id=&account=&before=&limit= — audit log, newest first.
 * `account` (a global account id, platform admins only) covers that person's users in every app.
 * `action` matches a prefix (`admin.` finds every admin action). Page by passing the response's
 * `next_before` back as `before`. Platform admins may omit tenant_id.
 */
export default defineEventHandler(async (event) => {
  const scope = await requireAdminScope(event)
  await ensureAdminConsoleSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const query = getQuery(event)
  const tenantId = scopedTenantId(scope, String(query.tenant_id || '').trim())
  const action = String(query.action || '').trim()
  const userId = String(query.user_id || '').trim()
  const accountId = String(query.account || '').trim()
  if (accountId && !scope.platform) throw createError({ statusCode: 403, statusMessage: 'Platform admin required' })
  // Cursor `<created_at>:<id>`: several rows can share one second.
  const [beforeAt, beforeId = ''] = String(query.before || '').split(':')
  const before = Number(beforeAt || 0)
  const limit = clampLimit(query.limit, 50, 200)

  const where: string[] = []
  const binds: unknown[] = []
  if (tenantId) {
    where.push('a.tenant_id = ?')
    binds.push(tenantId)
  }
  if (action) {
    // Prefix match without LIKE wildcards: `_` and `%` appear in action names.
    where.push('substr(a.action, 1, ?) = ?')
    binds.push(action.length, action)
  }
  if (userId) {
    where.push('a.user_id = ?')
    binds.push(userId)
  }
  if (accountId) {
    where.push('a.user_id IN (SELECT id FROM users WHERE global_account_id = ?)')
    binds.push(accountId)
  }
  if (Number.isFinite(before) && before > 0) {
    where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')
    binds.push(Math.floor(before), Math.floor(before), beforeId)
  }

  const rows = await getDb(event)
    .prepare(
      `SELECT a.id, a.tenant_id, a.user_id, u.email AS user_email, a.action, a.ip, a.user_agent, a.payload_json, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{ id: string; tenant_id: string | null; user_id: string | null; user_email: string | null; action: string; ip: string | null; user_agent: string | null; payload_json: string; created_at: number }>()

  const entries = (rows.results || []).map(({ payload_json, ...row }) => ({ ...row, payload: parseJsonObject(payload_json) }))
  return {
    entries,
    next_before: entries.length === limit ? `${entries[entries.length - 1].created_at}:${entries[entries.length - 1].id}` : null,
  }
})
