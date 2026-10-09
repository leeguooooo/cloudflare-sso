import { createError, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { oncePerDb } from './schema-once'
import { randomId } from './crypto'
import { decryptSecret, encryptSecret } from './totp'

/**
 * Event webhooks: an app (tenant) registers endpoints in the admin console and receives
 * signed POSTs when something happens to its users, so it can sign them out, drop data or
 * refresh entitlements without polling.
 *
 * Request: JSON `{ id, type, created, tenant_id, data }` with headers
 *   X-Leeguoo-Event: <type>
 *   X-Leeguoo-Delivery: <delivery id>         (same id on every retry — dedupe on it)
 *   X-Leeguoo-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Any 2xx is success. Failures retry after 5 min, 30 min, 2 h, 12 h, 24 h (from the
 * reconcile cron), then the delivery is `failed` and can be redelivered from the console.
 *
 * These are notifications. The blocking merge/delete calls in account-hooks.ts stay as they are.
 */

export const WEBHOOK_EVENTS = [
  'account.suspended',
  'account.restored',
  'account.deleted',
  'account.merged',
  'account.sessions_revoked',
  'account.mfa_reset',
  'entitlement.changed',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number] | 'webhook.ping'

const RETRY_DELAYS = [5 * 60, 30 * 60, 2 * 3600, 12 * 3600, 24 * 3600]
const TIMEOUT_MS = 8000

const webhookSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS webhook_endpoints (
         id TEXT PRIMARY KEY,
         tenant_id TEXT NOT NULL,
         url TEXT NOT NULL,
         events TEXT NOT NULL,
         secret_sealed TEXT NOT NULL,
         key_source TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
         description TEXT,
         created_by TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints (tenant_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS webhook_deliveries (
         id TEXT PRIMARY KEY,
         endpoint_id TEXT NOT NULL,
         tenant_id TEXT NOT NULL,
         event_type TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
         attempts INTEGER NOT NULL DEFAULT 0,
         last_status INTEGER,
         last_error TEXT,
         next_attempt_at INTEGER,
         created_at INTEGER NOT NULL,
         delivered_at INTEGER
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC)`).run()
  // Only pending rows are indexed: the retry sweep reads these, delivered history costs nothing.
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending'`)
    .run()
})

export const ensureWebhookSchema = (event: H3Event) => webhookSchema(getDb(event))

const now = () => Math.floor(Date.now() / 1000)

type KeySource = 'mfa_key' | 'pepper_v2'
const keyMaterial = (event: H3Event, source?: KeySource) => {
  const env = getEnv(event) as Record<string, string | undefined>
  const candidates: Array<[KeySource, string | undefined]> = [
    ['mfa_key', env.MFA_SECRET_KEY],
    ['pepper_v2', env.PASSWORD_PEPPER_V2],
  ]
  for (const [name, value] of candidates) {
    if ((!source || source === name) && value) return { source: name, material: `webhook:${value}` }
  }
  throw createError({ statusCode: 500, statusMessage: 'Webhook signing is not configured (MFA_SECRET_KEY or PASSWORD_PEPPER_V2)' })
}

export type EndpointRow = {
  id: string
  tenant_id: string
  url: string
  events: string
  secret_sealed: string
  key_source: KeySource
  status: 'active' | 'disabled'
  description: string | null
  created_by: string | null
  created_at: number
  updated_at: number
}

export const publicEndpoint = ({ secret_sealed: _secret, key_source: _source, ...row }: EndpointRow) => ({
  ...row,
  events: row.events.split(' ').filter(Boolean),
})

export const validateWebhookUrl = (raw: string) => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'url must be an absolute https URL' })
  }
  const host = url.hostname.toLowerCase()
  const local = host === 'localhost' || host.endsWith('.localhost') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host === '[::1]'
  if (url.protocol !== 'https:' || local || url.username || url.password) {
    throw createError({ statusCode: 400, statusMessage: 'url must be a public https URL without credentials' })
  }
  return url.toString()
}

export const normalizeEvents = (input: unknown) => {
  const list = Array.isArray(input) ? input.map(String) : String(input || '*').split(/[\s,]+/)
  const events = [...new Set(list.map((e) => e.trim()).filter(Boolean))]
  if (!events.length || events.includes('*')) return '*'
  const unknown = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))
  if (unknown.length) throw createError({ statusCode: 400, statusMessage: `Unknown events: ${unknown.join(', ')}` })
  return events.join(' ')
}

/** A new signing secret: returned to the admin once, stored sealed. */
export const newSigningSecret = async (event: H3Event) => {
  const secret = `whsec_${randomId(32)}`
  const { source, material } = keyMaterial(event)
  return { secret, sealed: await encryptSecret(material, secret), source }
}

const hmacHex = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What a receiver computes to verify a delivery (exported for tests and docs). */
export const signWebhookBody = async (secret: string, timestamp: number, body: string) => `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`

type DeliveryRow = {
  id: string
  endpoint_id: string
  tenant_id: string
  event_type: string
  payload_json: string
  status: string
  attempts: number
}

/** One attempt. Updates the delivery row with the outcome and the next retry time. */
export const attemptDelivery = async (event: H3Event, delivery: DeliveryRow, endpoint?: EndpointRow | null) => {
  const db = getDb(event)
  const target =
    endpoint || (await db.prepare(`SELECT * FROM webhook_endpoints WHERE id = ?`).bind(delivery.endpoint_id).first<EndpointRow>())
  const attempts = delivery.attempts + 1
  let status = 0
  let error = ''
  if (!target || target.status !== 'active') {
    error = 'endpoint disabled or removed'
  } else {
    try {
      const secret = await decryptSecret(keyMaterial(event, target.key_source).material, target.secret_sealed)
      const timestamp = now()
      const response = await fetch(target.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'leeguoo-account-webhooks/1',
          'x-leeguoo-event': delivery.event_type,
          'x-leeguoo-delivery': delivery.id,
          'x-leeguoo-signature': await signWebhookBody(secret, timestamp, delivery.payload_json),
        },
        body: delivery.payload_json,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      status = response.status
      if (status < 200 || status >= 300) error = `HTTP ${status}`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }
  const ok = !error
  const giveUp = !ok && (attempts > RETRY_DELAYS.length || !target || target.status !== 'active')
  await db
    .prepare(
      `UPDATE webhook_deliveries SET status = ?, attempts = ?, last_status = ?, last_error = ?, next_attempt_at = ?, delivered_at = ?
       WHERE id = ?`,
    )
    .bind(
      ok ? 'succeeded' : giveUp ? 'failed' : 'pending',
      attempts,
      status || null,
      ok ? null : error.slice(0, 300),
      ok || giveUp ? null : now() + RETRY_DELAYS[attempts - 1],
      ok ? now() : null,
      delivery.id,
    )
    .run()
  return { ok, status, error: error || null }
}

const subscribed = (endpoint: EndpointRow, type: string) => type === 'webhook.ping' || endpoint.events === '*' || endpoint.events.split(' ').includes(type)

/**
 * Records a delivery for every active endpoint of the tenant that subscribes to `type`, and
 * makes the first attempt after the response (waitUntil) or inline. Never throws.
 */
export const emitTenantEvent = async (
  event: H3Event,
  input: { tenantId: string; type: WebhookEventType; data: Record<string, unknown>; onlyEndpointId?: string },
) => {
  try {
    await ensureWebhookSchema(event)
    const db = getDb(event)
    const endpoints =
      (
        await db
          .prepare(`SELECT * FROM webhook_endpoints WHERE tenant_id = ? AND status = 'active'`)
          .bind(input.tenantId)
          .all<EndpointRow>()
      ).results || []
    const targets = endpoints.filter((e) => subscribed(e, input.type) && (!input.onlyEndpointId || e.id === input.onlyEndpointId))
    const deliveries: Array<{ delivery: DeliveryRow; endpoint: EndpointRow }> = []
    for (const endpoint of targets) {
      const id = `whd_${randomId(20)}`
      const payload = JSON.stringify({ id, type: input.type, created: now(), tenant_id: input.tenantId, data: input.data })
      const delivery: DeliveryRow = { id, endpoint_id: endpoint.id, tenant_id: input.tenantId, event_type: input.type, payload_json: payload, status: 'pending', attempts: 0 }
      await db
        .prepare(
          `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, event_type, payload_json, status, attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
        )
        .bind(id, endpoint.id, input.tenantId, input.type, payload, now(), now())
        .run()
      deliveries.push({ delivery, endpoint })
    }
    if (!deliveries.length) return []
    const send = Promise.all(deliveries.map(({ delivery, endpoint }) => attemptDelivery(event, delivery, endpoint)))
    const waitUntil = (event as { waitUntil?: (task: Promise<unknown>) => void }).waitUntil
    if (typeof waitUntil === 'function') waitUntil.call(event, send.catch(() => undefined))
    else await send
    return deliveries.map(({ delivery }) => delivery.id)
  } catch (error) {
    console.warn('webhook emit failed', { type: input.type, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

/**
 * An account-level event goes to every app the person uses, each with that app's own `sub`.
 * Pass `tenantUsers` when the users are about to disappear (deletion); otherwise they are read.
 */
export const emitAccountEvent = async (
  event: H3Event,
  input: { globalAccountId: string; type: WebhookEventType; data?: Record<string, unknown>; tenantUsers?: Array<{ tenant_id: string; id: string }> },
) => {
  try {
    const users =
      input.tenantUsers ||
      (
        await getDb(event)
          .prepare(`SELECT id, tenant_id FROM users WHERE global_account_id = ?`)
          .bind(input.globalAccountId)
          .all<{ id: string; tenant_id: string }>()
      ).results ||
      []
    for (const user of users) {
      await emitTenantEvent(event, {
        tenantId: user.tenant_id,
        type: input.type,
        data: { global_account_id: input.globalAccountId, sub: user.id, ...(input.data || {}) },
      })
    }
  } catch (error) {
    console.warn('account webhook emit failed', { type: input.type, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Retries due deliveries (called by the reconcile cron). */
export const retryDueDeliveries = async (event: H3Event, limit = 50) => {
  await ensureWebhookSchema(event)
  const due =
    (
      await getDb(event)
        .prepare(`SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`)
        .bind(now(), limit)
        .all<DeliveryRow>()
    ).results || []
  let succeeded = 0
  for (const delivery of due) if ((await attemptDelivery(event, delivery)).ok) succeeded += 1
  return { attempted: due.length, succeeded }
}
