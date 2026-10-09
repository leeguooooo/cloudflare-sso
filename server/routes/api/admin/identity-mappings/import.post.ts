import { createError, defineEventHandler, readBody } from 'h3'
import { requireTenantAdminOrService } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'
import { getDb } from '../../../../utils/env'
import { ensureIdentityMappingSchema, mapLegacyUser, SOURCE_SYSTEM_RE, type MappingRecordInput, type MappingResult } from '../../../../utils/identity-mapping'

const MAX_RECORDS = 100

/**
 * POST /api/admin/identity-mappings/import
 *   { tenant_id, source_system, records: [{ source_user_id, email, email_verified, display_name? } | { source_user_id, global_account_id }],
 *     create_missing?: boolean, dry_run?: boolean }
 * Maps an app's existing users to SSO accounts (rules in server/utils/identity-mapping.ts).
 * Idempotent: re-running a batch reports `unchanged` for rows already mapped. Up to 100
 * records per call. Tenant admin, or a service token of the tenant with `identity:mappings.write`.
 * Returns `{ run_id, dry_run, summary: { <outcome>: n }, results: [...] }`.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as {
    tenant_id?: string
    source_system?: string
    records?: MappingRecordInput[]
    create_missing?: boolean
    dry_run?: boolean
  }
  const tenantId = String(body.tenant_id || '').trim()
  const principal = await requireTenantAdminOrService(event, tenantId, 'identity:mappings.write')
  const sourceSystem = String(body.source_system || '').trim()
  if (!SOURCE_SYSTEM_RE.test(sourceSystem)) {
    throw createError({ statusCode: 400, statusMessage: 'source_system must be 2-32 chars: a-z, 0-9, _ or -' })
  }
  const records = Array.isArray(body.records) ? body.records : []
  if (!records.length || records.length > MAX_RECORDS) {
    throw createError({ statusCode: 400, statusMessage: `records must hold 1-${MAX_RECORDS} items` })
  }
  const tenant = await getDb(event).prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenantId).first<{ id: string }>()
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  await ensureIdentityMappingSchema(event)

  const dryRun = body.dry_run === true
  const runId = crypto.randomUUID()
  const seen = new Set<string>()
  const results: MappingResult[] = []
  for (const record of records) {
    const id = String(record?.source_user_id ?? '').trim()
    if (id && seen.has(id)) {
      results.push({ source_user_id: id, outcome: 'invalid', reason: 'duplicate source_user_id in this batch' })
      continue
    }
    seen.add(id)
    results.push(
      await mapLegacyUser(event, {
        tenantId,
        sourceSystem,
        record: record || {},
        createMissing: body.create_missing === true,
        dryRun,
        actor: principal.sub,
        runId,
      }),
    )
  }

  const summary: Record<string, number> = {}
  for (const result of results) summary[result.outcome] = (summary[result.outcome] || 0) + 1
  if (!dryRun) {
    await writeAuditLog(event, {
      tenantId,
      userId: principal.clientOnly ? null : principal.sub,
      action: 'admin.identity_mappings.import',
      payload: { run_id: runId, source_system: sourceSystem, summary, actor: principal.clientOnly ? principal.sub : undefined },
    })
  }
  return { run_id: runId, dry_run: dryRun, summary, results }
})
