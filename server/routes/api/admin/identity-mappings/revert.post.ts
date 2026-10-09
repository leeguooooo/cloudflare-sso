import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'
import { ensureIdentityMappingSchema, type MappingRow } from '../../../../utils/identity-mapping'

/**
 * POST /api/admin/identity-mappings/revert { tenant_id, mapping_id } or { tenant_id, run_id }
 * Undoes a wrong link: the mapping (or every active mapping of an import run) becomes
 * `reverted`, so the legacy id resolves to nothing and can be imported again. SSO accounts and
 * tenant users are left alone — the response lists accounts the run created, for review.
 * Tenant admins only (not service tokens).
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { tenant_id?: string; mapping_id?: string; run_id?: string }
  const tenantId = String(body.tenant_id || '').trim()
  const principal = await requireTenantAdmin(event, tenantId)
  const mappingId = String(body.mapping_id || '').trim()
  const runId = String(body.run_id || '').trim()
  if (!mappingId === !runId) throw createError({ statusCode: 400, statusMessage: 'mapping_id or run_id required (one of them)' })
  await ensureIdentityMappingSchema(event)

  const db = getDb(event)
  const column = mappingId ? 'id' : 'run_id'
  const targets =
    (
      await db
        .prepare(`SELECT * FROM identity_mappings WHERE tenant_id = ? AND ${column} = ? AND status = 'active'`)
        .bind(tenantId, mappingId || runId)
        .all<MappingRow>()
    ).results || []
  if (!targets.length) throw createError({ statusCode: 404, statusMessage: 'No active mapping found' })

  const now = Math.floor(Date.now() / 1000)
  await db
    .prepare(`UPDATE identity_mappings SET status = 'reverted', reverted_by = ?, reverted_at = ? WHERE tenant_id = ? AND ${column} = ? AND status = 'active'`)
    .bind(principal.sub, now, tenantId, mappingId || runId)
    .run()
  const createdAccounts = targets.filter((t) => t.outcome === 'created').map((t) => t.global_account_id)
  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'admin.identity_mappings.revert',
    payload: { mapping_id: mappingId || undefined, run_id: runId || undefined, reverted: targets.length, created_accounts: createdAccounts },
  })
  return { reverted: targets.length, created_accounts: createdAccounts }
})
