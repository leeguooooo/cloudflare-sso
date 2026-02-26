import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { writeAuditLog } from '../../../../utils/audit'
import { ensureBillingSchema } from '../../../../utils/billing'
import { requireTenantAdmin } from '../../../../utils/guard'

type IngestBody = {
  tenant_id?: string
  provider?: 'internal' | 'stripe' | 'manual' | 'system'
  event_id?: string
  event_type?: string
  occurred_at?: number
  subscription_id?: string
  payload?: Record<string, unknown>
}

type SubscriptionRow = {
  id: string
  tenant_id: string
}

type EventRow = {
  id: string
  tenant_id: string
  subscription_id: string | null
  provider: string
  event_id: string
  event_type: string
  occurred_at: number
  payload_json: string
  status: string
  error_message: string | null
  processed_at: number | null
  created_at: number
}

const ALLOWED_PROVIDERS = new Set(['internal', 'stripe', 'manual', 'system'])

const isObjectPayload = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const body = (await readBody(event)) as IngestBody
  const tenantId = body.tenant_id?.trim()
  const provider = body.provider?.trim()
  const eventId = body.event_id?.trim()
  const eventType = body.event_type?.trim()
  const subscriptionId = body.subscription_id?.trim() || null
  const occurredAt = Number(body.occurred_at || Math.floor(Date.now() / 1000))
  const payload = isObjectPayload(body.payload) ? body.payload : {}

  if (!tenantId || !provider || !eventId || !eventType) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id, provider, event_id, event_type are required' })
  }
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw createError({ statusCode: 400, statusMessage: 'provider must be one of: internal, stripe, manual, system' })
  }
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'occurred_at must be a unix timestamp' })
  }

  const principal = await requireTenantAdmin(event, tenantId)
  const db = getDb(event)

  let subscriptionRef: SubscriptionRow | null = null
  if (subscriptionId) {
    subscriptionRef = await db
      .prepare(`SELECT id, tenant_id FROM subscriptions WHERE id = ?`)
      .bind(subscriptionId)
      .first<SubscriptionRow>()
    if (!subscriptionRef) {
      throw createError({ statusCode: 404, statusMessage: 'subscription_id not found' })
    }
    if (subscriptionRef.tenant_id !== tenantId) {
      throw createError({ statusCode: 400, statusMessage: 'subscription tenant mismatch' })
    }
  }

  const existing = await db
    .prepare(
      `SELECT id, tenant_id, subscription_id, provider, event_id, event_type, occurred_at, payload_json, status, error_message, processed_at, created_at
       FROM subscription_events
       WHERE tenant_id = ? AND provider = ? AND event_id = ?
       LIMIT 1`,
    )
    .bind(tenantId, provider, eventId)
    .first<EventRow>()

  if (existing) {
    return {
      idempotent: true,
      event: existing,
    }
  }

  const rowId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO subscription_events
       (id, tenant_id, subscription_id, provider, event_id, event_type, occurred_at, payload_json, status, error_message, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)`,
    )
    .bind(rowId, tenantId, subscriptionRef?.id || null, provider, eventId, eventType, Math.floor(occurredAt), JSON.stringify(payload))
    .run()

  const created = await db
    .prepare(
      `SELECT id, tenant_id, subscription_id, provider, event_id, event_type, occurred_at, payload_json, status, error_message, processed_at, created_at
       FROM subscription_events
       WHERE id = ?`,
    )
    .bind(rowId)
    .first<EventRow>()

  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'billing.subscription_event.ingest',
    payload: {
      provider,
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionRef?.id || null,
    },
  })

  return {
    idempotent: false,
    event: created,
  }
})
