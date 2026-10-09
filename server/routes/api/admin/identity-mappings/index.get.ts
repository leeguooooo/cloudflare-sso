import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdminOrService } from '../../../../utils/guard'
import { clampLimit } from '../../../../utils/admin-console'
import { ensureIdentityMappingSchema, type MappingRow } from '../../../../utils/identity-mapping'

/**
 * GET /api/admin/identity-mappings?tenant_id=&source_system=&source_user_id=&run_id=&status=&limit=
 * Mappings, newest first. An app's backend resolves a legacy id with
 * `source_system` + `source_user_id` (→ `user_id`, the SSO `sub` in its tenant).
 * Tenant admin, or a service token of the tenant with `identity:mappings.read`.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '').trim()
  await requireTenantAdminOrService(event, tenantId, 'identity:mappings.read')
  await ensureIdentityMappingSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const filters: Array<[string, string]> = [
    ['source_system', String(query.source_system || '').trim()],
    ['source_user_id', String(query.source_user_id || '').trim()],
    ['run_id', String(query.run_id || '').trim()],
    ['status', String(query.status || '').trim()],
  ]
  const active = filters.filter(([, value]) => value)
  const rows = await getDb(event)
    .prepare(
      `SELECT m.*, g.email AS email FROM identity_mappings m LEFT JOIN global_accounts g ON g.id = m.global_account_id
       WHERE m.tenant_id = ?${active.map(([column]) => ` AND m.${column} = ?`).join('')}
       ORDER BY m.mapped_at DESC LIMIT ?`,
    )
    .bind(tenantId, ...active.map(([, value]) => value), clampLimit(query.limit, 50, 200))
    .all<MappingRow & { email: string | null }>()
  return { mappings: rows.results || [] }
})
