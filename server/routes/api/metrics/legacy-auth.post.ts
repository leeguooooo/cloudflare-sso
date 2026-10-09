import { createError, defineEventHandler, readBody } from 'h3'
import { requireTenantAdminOrService } from '../../../utils/guard'
import { addLegacyUsage } from '../../../utils/legacy-usage'
import { utcDay } from '../../../utils/entitlement-metrics'

type Report = { client_id?: string; path?: string; legacy_hits?: number; total_requests?: number; day?: string }

/**
 * POST /api/metrics/legacy-auth { tenant_id, reports: [{ client_id, path, legacy_hits, total_requests, day? }] }
 * An app backend reports how many requests it served through a pre-SSO auth path (e.g.
 * path "header-identity") out of all requests, since its last report. Counts add up per UTC
 * day. Service token of the tenant with `metrics:legacy.write` (or a tenant admin). Max 50 rows.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { tenant_id?: string; reports?: Report[] }
  const tenantId = String(body.tenant_id || '').trim()
  await requireTenantAdminOrService(event, tenantId, 'metrics:legacy.write')
  const reports = Array.isArray(body.reports) ? body.reports : []
  if (!reports.length || reports.length > 50) throw createError({ statusCode: 400, statusMessage: 'reports must hold 1-50 items' })

  const today = utcDay(Math.floor(Date.now() / 1000))
  const rows = reports.map((report, index) => {
    const clientId = String(report.client_id || '').trim()
    const path = String(report.path || '').trim()
    const hits = Number(report.legacy_hits)
    const total = Number(report.total_requests)
    const day = String(report.day || today)
    const valid =
      /^[\w.:-]{1,64}$/.test(clientId) &&
      /^[\w.:/-]{1,64}$/.test(path) &&
      Number.isInteger(hits) && hits >= 0 &&
      Number.isInteger(total) && total >= hits &&
      /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today
    if (!valid) throw createError({ statusCode: 400, statusMessage: `reports[${index}] invalid: client_id, path, integer legacy_hits <= total_requests, day (yyyy-mm-dd, not future)` })
    return { clientId, path, hits, total, day }
  })
  for (const row of rows) {
    await addLegacyUsage(event, { tenantId, day: row.day, clientId: row.clientId, path: row.path, legacyHits: row.hits, totalRequests: row.total })
  }
  return { ok: true, accepted: rows.length }
})
