import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { ensureWebhookSchema, publicEndpoint, WEBHOOK_EVENTS, type EndpointRow } from '../../../../utils/webhooks'

/** GET /api/admin/webhooks?tenant_id= — the tenant's webhook endpoints (no secrets) and the event catalog. */
export default defineEventHandler(async (event) => {
  const tenantId = String(getQuery(event).tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  await ensureWebhookSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const db = getDb(event)
  const endpoints =
    (await db.prepare(`SELECT * FROM webhook_endpoints WHERE tenant_id = ? ORDER BY created_at`).bind(tenantId).all<EndpointRow>()).results || []
  const stats =
    (
      await db
        .prepare(
          `SELECT endpoint_id, status, count(*) AS n FROM webhook_deliveries
           WHERE tenant_id = ? AND created_at > ? GROUP BY endpoint_id, status`,
        )
        .bind(tenantId, Math.floor(Date.now() / 1000) - 7 * 86400)
        .all<{ endpoint_id: string; status: string; n: number }>()
    ).results || []
  return {
    events: WEBHOOK_EVENTS,
    endpoints: endpoints.map((row) => ({
      ...publicEndpoint(row),
      last_7_days: Object.fromEntries(stats.filter((s) => s.endpoint_id === row.id).map((s) => [s.status, Number(s.n)])),
    })),
  }
})
