import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { clampLimit } from '../../../../utils/admin-console'
import { ensureWebhookSchema } from '../../../../utils/webhooks'

/** GET /api/admin/webhooks/deliveries?tenant_id=&endpoint_id=&status=&limit= — recent deliveries, newest first, with payloads. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  await ensureWebhookSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const endpointId = String(query.endpoint_id || '').trim()
  const status = String(query.status || '').trim()
  const rows =
    (
      await getDb(event)
        .prepare(
          `SELECT id, endpoint_id, event_type, payload_json, status, attempts, last_status, last_error, next_attempt_at, created_at, delivered_at
           FROM webhook_deliveries
           WHERE tenant_id = ? AND (? = '' OR endpoint_id = ?) AND (? = '' OR status = ?)
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(tenantId, endpointId, endpointId, status, status, clampLimit(query.limit, 50, 200))
        .all<Record<string, unknown> & { payload_json: string }>()
    ).results || []
  return {
    deliveries: rows.map(({ payload_json, ...row }) => {
      let payload: unknown = null
      try {
        payload = JSON.parse(payload_json)
      } catch {
        payload = null
      }
      return { ...row, payload }
    }),
  }
})
