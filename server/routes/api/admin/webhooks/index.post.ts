import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'
import {
  emitTenantEvent,
  ensureWebhookSchema,
  newSigningSecret,
  normalizeEvents,
  publicEndpoint,
  validateWebhookUrl,
  type EndpointRow,
} from '../../../../utils/webhooks'

type Action = 'create' | 'update' | 'disable' | 'enable' | 'delete' | 'rotate_secret' | 'test'
const ACTIONS: readonly Action[] = ['create', 'update', 'disable', 'enable', 'delete', 'rotate_secret', 'test']
const MAX_ENDPOINTS = 10

/**
 * POST /api/admin/webhooks { tenant_id, action, endpoint_id?, url?, events?, description? }
 * - `create { url, events? ("*" or a list), description? }` → `{ endpoint, secret }` — the secret is shown once
 * - `update { endpoint_id, url?, events?, description? }`, `disable` / `enable` / `delete { endpoint_id }`
 * - `rotate_secret { endpoint_id }` → `{ secret }`; `test { endpoint_id }` sends a `webhook.ping`
 * Tenant admins. Every change is audited.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const tenantId = String(body.tenant_id || '').trim()
  const principal = await requireTenantAdmin(event, tenantId)
  const action = body.action as Action
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, statusMessage: `action must be one of: ${ACTIONS.join(', ')}` })
  await ensureWebhookSchema(event)
  const db = getDb(event)
  const now = Math.floor(Date.now() / 1000)
  const audit = (endpointId: string, extra: Record<string, unknown> = {}) =>
    writeAuditLog(event, { tenantId, userId: principal.sub, action: `admin.webhook.${action}`, payload: { endpoint_id: endpointId, ...extra } })

  if (action === 'create') {
    const count = await db.prepare(`SELECT count(*) AS n FROM webhook_endpoints WHERE tenant_id = ?`).bind(tenantId).first<{ n: number }>()
    if (Number(count?.n || 0) >= MAX_ENDPOINTS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_ENDPOINTS} endpoints per tenant` })
    const url = validateWebhookUrl(String(body.url || ''))
    const events = normalizeEvents(body.events)
    const { secret, sealed, source } = await newSigningSecret(event)
    const id = `whe_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    await db
      .prepare(
        `INSERT INTO webhook_endpoints (id, tenant_id, url, events, secret_sealed, key_source, status, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(id, tenantId, url, events, sealed, source, String(body.description || '').slice(0, 200) || null, principal.sub, now, now)
      .run()
    await audit(id, { url, events })
    const row = await db.prepare(`SELECT * FROM webhook_endpoints WHERE id = ?`).bind(id).first<EndpointRow>()
    return { endpoint: publicEndpoint(row!), secret }
  }

  const endpointId = String(body.endpoint_id || '').trim()
  const endpoint = await db.prepare(`SELECT * FROM webhook_endpoints WHERE id = ? AND tenant_id = ?`).bind(endpointId, tenantId).first<EndpointRow>()
  if (!endpoint) throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' })

  if (action === 'update') {
    const url = body.url === undefined ? endpoint.url : validateWebhookUrl(String(body.url))
    const events = body.events === undefined ? endpoint.events : normalizeEvents(body.events)
    const description = body.description === undefined ? endpoint.description : String(body.description || '').slice(0, 200) || null
    await db
      .prepare(`UPDATE webhook_endpoints SET url = ?, events = ?, description = ?, updated_at = ? WHERE id = ?`)
      .bind(url, events, description, now, endpoint.id)
      .run()
    await audit(endpoint.id, { url, events })
  } else if (action === 'disable' || action === 'enable') {
    await db
      .prepare(`UPDATE webhook_endpoints SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(action === 'disable' ? 'disabled' : 'active', now, endpoint.id)
      .run()
    await audit(endpoint.id)
  } else if (action === 'delete') {
    await db.batch([
      db.prepare(`DELETE FROM webhook_deliveries WHERE endpoint_id = ?`).bind(endpoint.id),
      db.prepare(`DELETE FROM webhook_endpoints WHERE id = ?`).bind(endpoint.id),
    ])
    await audit(endpoint.id, { url: endpoint.url })
    return { ok: true }
  } else if (action === 'rotate_secret') {
    const { secret, sealed, source } = await newSigningSecret(event)
    await db
      .prepare(`UPDATE webhook_endpoints SET secret_sealed = ?, key_source = ?, updated_at = ? WHERE id = ?`)
      .bind(sealed, source, now, endpoint.id)
      .run()
    await audit(endpoint.id)
    return { ok: true, secret }
  } else if (action === 'test') {
    if (endpoint.status !== 'active') throw createError({ statusCode: 400, statusMessage: 'Enable the endpoint first' })
    const ids = await emitTenantEvent(event, { tenantId, type: 'webhook.ping', data: { endpoint_id: endpoint.id }, onlyEndpointId: endpoint.id })
    return { ok: true, delivery_id: ids[0] || null }
  }

  const row = await db.prepare(`SELECT * FROM webhook_endpoints WHERE id = ?`).bind(endpoint.id).first<EndpointRow>()
  return { endpoint: publicEndpoint(row!) }
})
