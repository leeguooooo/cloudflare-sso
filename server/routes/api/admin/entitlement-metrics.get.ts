import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { clampLimit } from '../../../utils/admin-console'
import { ensureEntitlementMetricsSchema, utcDay } from '../../../utils/entitlement-metrics'

/**
 * GET /api/admin/entitlement-metrics?tenant_id=&days=7 — entitlement checks per app (client)
 * and key over the last `days` UTC days (max 90): allowed, denied and the deny rate, plus a
 * per-day series. A sudden deny spike usually means a billing sync or a key rename broke.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  await ensureEntitlementMetricsSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const days = clampLimit(query.days, 7, 90)
  const since = utcDay(Math.floor(Date.now() / 1000) - (days - 1) * 86400)

  const rows =
    (
      await getDb(event)
        .prepare(
          `SELECT day, client_id, entitlement_key, result, count FROM entitlement_check_daily
           WHERE tenant_id = ? AND day >= ?`,
        )
        .bind(tenantId, since)
        .all<{ day: string; client_id: string; entitlement_key: string; result: 'allowed' | 'denied'; count: number }>()
    ).results || []

  const byKey = new Map<string, { client_id: string; entitlement_key: string; allowed: number; denied: number }>()
  const byDay = new Map<string, { day: string; allowed: number; denied: number }>()
  for (const row of rows) {
    const id = `${row.client_id}\u0000${row.entitlement_key}`
    const item = byKey.get(id) || { client_id: row.client_id, entitlement_key: row.entitlement_key, allowed: 0, denied: 0 }
    item[row.result] += Number(row.count)
    byKey.set(id, item)
    const day = byDay.get(row.day) || { day: row.day, allowed: 0, denied: 0 }
    day[row.result] += Number(row.count)
    byDay.set(row.day, day)
  }
  const rate = (item: { allowed: number; denied: number }) => {
    const total = item.allowed + item.denied
    return total ? Math.round((item.denied / total) * 1000) / 1000 : 0
  }

  return {
    tenant_id: tenantId,
    days,
    since,
    totals: [...byKey.values()]
      .map((item) => ({ ...item, total: item.allowed + item.denied, deny_rate: rate(item) }))
      .sort((a, b) => b.total - a.total),
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
})
