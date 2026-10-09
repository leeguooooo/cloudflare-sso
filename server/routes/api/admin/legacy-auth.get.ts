import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { clampLimit } from '../../../utils/admin-console'
import { utcDay } from '../../../utils/entitlement-metrics'
import { CUT_DAYS, CUT_THRESHOLD, ensureLegacyUsageSchema, readyToCut, type LegacyDay } from '../../../utils/legacy-usage'

/**
 * GET /api/admin/legacy-auth?tenant_id=&days=14 — per app and legacy path: hits, requests,
 * fallback rate, a per-day series and `ready_to_cut` (every one of the last 7 days reported and
 * under 0.1%). Tenant admins.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  await ensureLegacyUsageSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const days = clampLimit(query.days, 14, 90)
  const now = Math.floor(Date.now() / 1000)
  const today = utcDay(now)
  const since = utcDay(now - (days - 1) * 86400)

  const rows =
    (
      await getDb(event)
        .prepare(`SELECT day, client_id, path, legacy_hits, total_requests FROM legacy_auth_daily WHERE tenant_id = ? AND day >= ? ORDER BY day`)
        .bind(tenantId, since)
        .all<LegacyDay & { client_id: string; path: string }>()
    ).results || []

  const groups = new Map<string, { client_id: string; path: string; daily: LegacyDay[] }>()
  for (const row of rows) {
    const id = `${row.client_id}\u0000${row.path}`
    const group = groups.get(id) || { client_id: row.client_id, path: row.path, daily: [] }
    group.daily.push({ day: row.day, legacy_hits: Number(row.legacy_hits), total_requests: Number(row.total_requests) })
    groups.set(id, group)
  }

  return {
    tenant_id: tenantId,
    days,
    threshold: CUT_THRESHOLD,
    cut_days: CUT_DAYS,
    paths: [...groups.values()].map((group) => {
      const hits = group.daily.reduce((sum, d) => sum + d.legacy_hits, 0)
      const total = group.daily.reduce((sum, d) => sum + d.total_requests, 0)
      return {
        ...group,
        legacy_hits: hits,
        total_requests: total,
        rate: total ? hits / total : 0,
        ready_to_cut: readyToCut(group.daily, today),
      }
    }),
  }
})
