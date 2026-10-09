import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requirePlatformAdmin } from '../../../../utils/guard'
import { clampLimit } from '../../../../utils/admin-console'

/**
 * GET /api/admin/accounts?q=&status=&limit= — global accounts (one per person, across every app),
 * newest first. `q` matches email, display name or exact account id. Platform admins only.
 */
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const query = getQuery(event)
  const q = String(query.q || '').trim().toLowerCase()
  const status = String(query.status || '').trim()
  const limit = clampLimit(query.limit, 50, 200)

  const rows = await getDb(event)
    .prepare(
      `SELECT
         g.id, g.email, g.display_name, g.avatar_url, g.status, g.created_at,
         (SELECT group_concat(u.tenant_id, ',') FROM users u WHERE u.global_account_id = g.id) AS tenants,
         (SELECT group_concat(i.provider, ',') FROM global_external_identities i WHERE i.global_account_id = g.id) AS providers,
         (SELECT max(s.created_at) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.global_account_id = g.id) AS last_sign_in_at
       FROM global_accounts g
       WHERE (? = '' OR g.normalized_email LIKE ? OR lower(coalesce(g.display_name, '')) LIKE ? OR g.id = ?)
         AND (? = '' OR g.status = ?)
       ORDER BY g.created_at DESC
       LIMIT ?`,
    )
    .bind(q, `%${q}%`, `%${q}%`, q, status, status, limit)
    .all<{ id: string; email: string; display_name: string | null; avatar_url: string | null; status: string; created_at: number; tenants: string | null; providers: string | null; last_sign_in_at: number | null }>()

  const split = (value: string | null) => (value ? [...new Set(value.split(','))] : [])
  return {
    accounts: (rows.results || []).map((row) => ({
      ...row,
      tenants: split(row.tenants),
      providers: split(row.providers),
      last_sign_in_at: row.last_sign_in_at ? Number(row.last_sign_in_at) : null,
    })),
  }
})
