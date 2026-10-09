import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'
import { attemptDelivery, ensureWebhookSchema } from '../../../../utils/webhooks'

/** POST /api/admin/webhooks/deliveries { tenant_id, delivery_id } — send a delivery again now (same delivery id). */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { tenant_id?: string; delivery_id?: string }
  const tenantId = String(body.tenant_id || '').trim()
  const principal = await requireTenantAdmin(event, tenantId)
  await ensureWebhookSchema(event)
  const delivery = await getDb(event)
    .prepare(`SELECT id, endpoint_id, tenant_id, event_type, payload_json, status, attempts FROM webhook_deliveries WHERE id = ? AND tenant_id = ?`)
    .bind(String(body.delivery_id || ''), tenantId)
    .first<{ id: string; endpoint_id: string; tenant_id: string; event_type: string; payload_json: string; status: string; attempts: number }>()
  if (!delivery) throw createError({ statusCode: 404, statusMessage: 'Delivery not found' })
  // A manual redelivery gets a fresh retry budget.
  const result = await attemptDelivery(event, { ...delivery, attempts: 0 })
  await writeAuditLog(event, { tenantId, userId: principal.sub, action: 'admin.webhook.redeliver', payload: { delivery_id: delivery.id, ok: result.ok } })
  return result
})
