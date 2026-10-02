import { H3Event } from 'h3'
import { getDb } from './env'
import { nowInSeconds } from './crypto'
import { provisionTenantUserForGlobalAccount } from './identity'

/**
 * Applies one row of subscription_events to subscriptions + entitlements.
 *
 * Event types (payload fields in brackets are optional):
 * - subscription.activated / subscription.renewed / subscription.updated
 *     { plan_key, user_id | global_account_id, [provider_ref], [status: trialing|active],
 *       [current_period_start], [current_period_end], [cancel_at_period_end] }
 *     Creates the subscription when it does not exist yet, otherwise updates it.
 * - subscription.past_due   — entitlements stay until the period ends (grace).
 * - subscription.canceled   { [cancel_at_period_end], [canceled_at] }
 *     cancel_at_period_end=true keeps access until current_period_end; otherwise access ends now.
 * - subscription.expired    — access ends at occurred_at.
 * - entitlement.granted / entitlement.revoked
 *     { user_id | global_account_id, entitlement_key, [valid_to] } — manual grants outside plans.
 * Anything else is marked `ignored`. Events older than the last one applied to the same
 * subscription are ignored too, so providers that deliver out of order cannot roll state back.
 */

export type SubscriptionEventRow = {
  id: string
  tenant_id: string
  subscription_id: string | null
  provider: string
  event_id: string
  event_type: string
  occurred_at: number
  payload_json: string
}

type Outcome = { status: 'applied' | 'ignored'; subscriptionId?: string | null; note?: string }

export type SubscriptionRow = {
  id: string
  tenant_id: string
  user_id: string
  plan_id: string
  status: string
  started_at: number
  current_period_start: number | null
  current_period_end: number | null
  cancel_at_period_end: number
  meta_json: string
}

class BillingEventError extends Error {}

const num = (value: unknown) => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  try {
    const parsed = JSON.parse(raw || '')
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const resolveUserId = async (event: H3Event, tenantId: string, payload: Record<string, unknown>) => {
  const db = getDb(event)
  const userId = text(payload.user_id)
  if (userId) {
    const row = await db.prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`).bind(userId, tenantId).first<{ id: string }>()
    if (!row) throw new BillingEventError('user_id not found in tenant')
    return row.id
  }
  const globalAccountId = text(payload.global_account_id)
  if (!globalAccountId) throw new BillingEventError('payload.user_id or payload.global_account_id required')
  const account = await db
    .prepare(`SELECT id, email, locale FROM global_accounts WHERE id = ?`)
    .bind(globalAccountId)
    .first<{ id: string; email: string; locale?: string | null }>()
  if (!account) throw new BillingEventError('global_account_id not found')
  // A purchase can precede the user's first sign-in to this app: provision the tenant user now.
  const provisioned = await provisionTenantUserForGlobalAccount(event, {
    tenantId,
    globalAccountId: account.id,
    email: account.email,
    locale: account.locale || 'en',
  })
  return provisioned.user.id
}

const findSubscription = async (event: H3Event, row: SubscriptionEventRow, payload: Record<string, unknown>) => {
  const db = getDb(event)
  if (row.subscription_id) {
    return db.prepare(`SELECT * FROM subscriptions WHERE id = ? AND tenant_id = ?`).bind(row.subscription_id, row.tenant_id).first<SubscriptionRow>()
  }
  const providerRef = text(payload.provider_ref)
  if (!providerRef) return null
  return db
    .prepare(`SELECT * FROM subscriptions WHERE tenant_id = ? AND provider = ? AND provider_ref = ?`)
    .bind(row.tenant_id, row.provider, providerRef)
    .first<SubscriptionRow>()
}

/** Makes the plan's entitlements cover [subscription start, accessUntil) — null means open-ended. */
export const syncPlanEntitlements = async (event: H3Event, sub: SubscriptionRow, accessUntil: number | null) => {
  const db = getDb(event)
  const plan = await db.prepare(`SELECT entitlement_keys_json FROM plans WHERE id = ?`).bind(sub.plan_id).first<{ entitlement_keys_json: string }>()
  const keys = parseJson<unknown[]>(plan?.entitlement_keys_json, []).filter((k): k is string => typeof k === 'string' && Boolean(k))
  const now = nowInSeconds()
  const validFrom = sub.started_at
  const revoked = accessUntil !== null && accessUntil <= validFrom
  for (const key of keys) {
    const updated = await db
      .prepare(
        `UPDATE entitlements
         SET valid_to = ?, status = ?, revoked_at = ?, updated_at = ?
         WHERE subscription_id = ? AND entitlement_key = ? AND source = 'plan'`,
      )
      .bind(revoked ? null : accessUntil, revoked ? 'revoked' : 'granted', revoked ? now : null, now, sub.id, key)
      .run()
    if (updated.meta?.changes) continue
    if (revoked) continue
    await db
      .prepare(
        `INSERT INTO entitlements (id, tenant_id, user_id, subscription_id, entitlement_key, source, status, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, 'plan', 'granted', ?, ?)`,
      )
      .bind(crypto.randomUUID(), sub.tenant_id, sub.user_id, sub.id, key, validFrom, accessUntil)
      .run()
  }
}

const lastAppliedAt = (sub: SubscriptionRow) => Number(parseJson<Record<string, unknown>>(sub.meta_json, {}).last_event_at || 0)

const writeSubscription = async (
  event: H3Event,
  sub: SubscriptionRow,
  changes: Partial<Pick<SubscriptionRow, 'status' | 'current_period_start' | 'current_period_end' | 'cancel_at_period_end' | 'plan_id'>> & { canceled_at?: number | null },
  occurredAt: number,
) => {
  const meta = { ...parseJson<Record<string, unknown>>(sub.meta_json, {}), last_event_at: occurredAt }
  const next = { ...sub, ...changes, meta_json: JSON.stringify(meta) }
  await getDb(event)
    .prepare(
      `UPDATE subscriptions
       SET status = ?, plan_id = ?, current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?,
           canceled_at = COALESCE(?, canceled_at), meta_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      next.status,
      next.plan_id,
      next.current_period_start,
      next.current_period_end,
      next.cancel_at_period_end ? 1 : 0,
      changes.canceled_at ?? null,
      next.meta_json,
      nowInSeconds(),
      sub.id,
    )
    .run()
  return next
}

const upsertFromActivation = async (event: H3Event, row: SubscriptionEventRow, payload: Record<string, unknown>, existing: SubscriptionRow | null) => {
  const db = getDb(event)
  const planKey = text(payload.plan_key)
  const plan = planKey
    ? await db
        .prepare(`SELECT id, billing_cycle FROM plans WHERE tenant_id = ? AND plan_key = ?`)
        .bind(row.tenant_id, planKey)
        .first<{ id: string; billing_cycle: string }>()
    : null
  if (planKey && !plan) throw new BillingEventError(`Unknown plan_key: ${planKey}`)
  const status = text(payload.status) === 'trialing' ? 'trialing' : 'active'
  const periodStart = num(payload.current_period_start) ?? row.occurred_at
  const periodEnd = num(payload.current_period_end) ?? null
  const cancelAtPeriodEnd = payload.cancel_at_period_end === true ? 1 : 0

  if (!existing) {
    if (!plan) throw new BillingEventError('payload.plan_key required to create a subscription')
    const userId = await resolveUserId(event, row.tenant_id, payload)
    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO subscriptions
         (id, tenant_id, user_id, plan_id, provider, provider_ref, status, started_at, current_period_start, current_period_end, cancel_at_period_end, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, row.tenant_id, userId, plan.id, row.provider, text(payload.provider_ref) || null, status, periodStart, periodStart, periodEnd, cancelAtPeriodEnd, JSON.stringify({ last_event_at: row.occurred_at }))
      .run()
    const created = await db.prepare(`SELECT * FROM subscriptions WHERE id = ?`).bind(id).first<SubscriptionRow>()
    if (!created) throw new BillingEventError('Failed to create subscription')
    // A one-time purchase without a period end is lifetime access.
    await syncPlanEntitlements(event, created, periodEnd)
    return created.id
  }

  const updated = await writeSubscription(
    event,
    existing,
    {
      status: existing.status === 'trialing' || existing.status === 'past_due' || existing.status === 'active' ? status : existing.status,
      plan_id: plan?.id || existing.plan_id,
      current_period_start: num(payload.current_period_start) ?? existing.current_period_start,
      current_period_end: num(payload.current_period_end) ?? existing.current_period_end,
      cancel_at_period_end: payload.cancel_at_period_end === undefined ? existing.cancel_at_period_end : cancelAtPeriodEnd,
    },
    row.occurred_at,
  )
  if (updated.status === 'active' || updated.status === 'trialing') {
    await syncPlanEntitlements(event, updated, updated.current_period_end)
  }
  return existing.id
}

const applyManualEntitlement = async (event: H3Event, row: SubscriptionEventRow, payload: Record<string, unknown>, grant: boolean) => {
  const db = getDb(event)
  const key = text(payload.entitlement_key)
  if (!key) throw new BillingEventError('payload.entitlement_key required')
  const userId = await resolveUserId(event, row.tenant_id, payload)
  const now = nowInSeconds()
  if (grant) {
    const validTo = num(payload.valid_to) ?? null
    if (validTo !== null && validTo <= row.occurred_at) throw new BillingEventError('valid_to must be after occurred_at')
    await db
      .prepare(
        `INSERT OR IGNORE INTO entitlements (id, tenant_id, user_id, subscription_id, entitlement_key, source, status, valid_from, valid_to)
         VALUES (?, ?, ?, NULL, ?, 'manual', 'granted', ?, ?)`,
      )
      .bind(crypto.randomUUID(), row.tenant_id, userId, key, row.occurred_at, validTo)
      .run()
  } else {
    await db
      .prepare(
        `UPDATE entitlements SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE tenant_id = ? AND user_id = ? AND entitlement_key = ? AND source = 'manual' AND status = 'granted'`,
      )
      .bind(now, now, row.tenant_id, userId, key)
      .run()
  }
}

const apply = async (event: H3Event, row: SubscriptionEventRow): Promise<Outcome> => {
  const payload = parseJson<Record<string, unknown>>(row.payload_json, {})
  const type = row.event_type

  if (type === 'entitlement.granted' || type === 'entitlement.revoked') {
    await applyManualEntitlement(event, row, payload, type === 'entitlement.granted')
    return { status: 'applied' }
  }
  if (!type.startsWith('subscription.')) return { status: 'ignored', note: 'unknown event type' }

  const existing = await findSubscription(event, row, payload)
  if (existing && row.occurred_at < lastAppliedAt(existing)) {
    return { status: 'ignored', subscriptionId: existing.id, note: 'older than the last applied event' }
  }

  if (type === 'subscription.activated' || type === 'subscription.renewed' || type === 'subscription.updated') {
    return { status: 'applied', subscriptionId: await upsertFromActivation(event, row, payload, existing) }
  }
  if (!existing) throw new BillingEventError('Subscription not found (subscription_id or payload.provider_ref)')

  if (type === 'subscription.past_due') {
    await writeSubscription(event, existing, { status: 'past_due' }, row.occurred_at)
    return { status: 'applied', subscriptionId: existing.id }
  }
  if (type === 'subscription.canceled') {
    if (payload.cancel_at_period_end === true && existing.current_period_end) {
      const updated = await writeSubscription(event, existing, { cancel_at_period_end: 1 }, row.occurred_at)
      await syncPlanEntitlements(event, updated, existing.current_period_end)
    } else {
      const canceledAt = num(payload.canceled_at) ?? row.occurred_at
      const updated = await writeSubscription(event, existing, { status: 'canceled', canceled_at: canceledAt }, row.occurred_at)
      await syncPlanEntitlements(event, updated, canceledAt)
    }
    return { status: 'applied', subscriptionId: existing.id }
  }
  if (type === 'subscription.expired') {
    if (existing.status === 'expired' || existing.status === 'canceled') {
      return { status: 'ignored', subscriptionId: existing.id, note: `already ${existing.status}` }
    }
    const updated = await writeSubscription(event, existing, { status: 'expired' }, row.occurred_at)
    await syncPlanEntitlements(event, updated, Math.min(row.occurred_at, existing.current_period_end || row.occurred_at))
    return { status: 'applied', subscriptionId: existing.id }
  }
  return { status: 'ignored', subscriptionId: existing.id, note: 'unknown subscription event' }
}

/** Applies the event and records the outcome on the event row. Never throws for bad events. */
export const processSubscriptionEvent = async (event: H3Event, row: SubscriptionEventRow) => {
  const db = getDb(event)
  try {
    const outcome = await apply(event, row)
    await db
      .prepare(`UPDATE subscription_events SET status = ?, subscription_id = COALESCE(?, subscription_id), error_message = ?, processed_at = ? WHERE id = ?`)
      .bind(outcome.status, outcome.subscriptionId || null, outcome.note || null, nowInSeconds(), row.id)
      .run()
    return { status: outcome.status, error: null as string | null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .prepare(`UPDATE subscription_events SET status = 'failed', error_message = ?, processed_at = ? WHERE id = ?`)
      .bind(message.slice(0, 500), nowInSeconds(), row.id)
      .run()
    return { status: 'failed' as const, error: message }
  }
}
