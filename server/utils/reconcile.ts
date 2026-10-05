import { H3Event } from 'h3'
import { getDb } from './env'
import { nowInSeconds } from './crypto'
import { ensureBillingSchema } from './billing'
import { reconcileAfdianOrders } from './afdian'
import { processSubscriptionEvent, syncPlanEntitlements, type SubscriptionEventRow, type SubscriptionRow } from './billing-events'

/** Subscriptions that stopped renewing keep access this long past their period end. */
const EXPIRY_GRACE_SECONDS = 3 * 86400
/** Events still `pending` after this long were interrupted mid-ingest and are re-applied. */
const STUCK_EVENT_SECONDS = 5 * 60
/** A sign-in failure count per hour, per tenant, above which the run raises an alert. */
const LOGIN_FAILURE_ALERT_PER_HOUR = 200

export type ReconcileReport = {
  ran_at: number
  expired_subscriptions: string[]
  repaired_entitlements: string[]
  retried_events: Array<{ id: string; status: string }>
  failed_events: number
  overdue_without_renewal: string[]
  alerts: string[]
  /** Paid afdian orders pulled from the open API (null when AFDIAN_TOKEN / AFDIAN_PLANS are unset). */
  afdian?: { checked: number; matched: number; unmatched: number } | null
}

const planKeys = async (event: H3Event, planId: string) => {
  const row = await getDb(event).prepare(`SELECT entitlement_keys_json FROM plans WHERE id = ?`).bind(planId).first<{ entitlement_keys_json: string }>()
  try {
    const keys = JSON.parse(row?.entitlement_keys_json || '[]')
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Where a subscription's plan entitlements should end, or undefined when they should not exist. */
const expectedAccessUntil = (sub: SubscriptionRow & { canceled_at?: number | null }) => {
  if (sub.status === 'canceled') return sub.canceled_at ?? sub.current_period_end ?? null
  if (sub.status === 'expired') return sub.current_period_end ?? null
  return sub.current_period_end ?? null
}

/**
 * Brings subscriptions and entitlements back in line with each other and with time:
 * 1. re-applies events stuck in `pending`;
 * 2. expires subscriptions whose access ran out (cancel at period end, or past_due) after a grace;
 * 3. repairs plan entitlements whose window differs from the subscription;
 * 4. reports active subscriptions far past their period end with no renewal, failed events and
 *    sign-in failure spikes as alerts;
 * 5. applies paid afdian orders the webhook missed (when the afdian API is configured).
 * Every step is idempotent, so running it often is safe.
 */
export const reconcileBilling = async (event: H3Event): Promise<ReconcileReport> => {
  await ensureBillingSchema(event)
  const db = getDb(event)
  const now = nowInSeconds()
  const report: ReconcileReport = {
    ran_at: now,
    expired_subscriptions: [],
    repaired_entitlements: [],
    retried_events: [],
    failed_events: 0,
    overdue_without_renewal: [],
    alerts: [],
  }

  const stuck =
    (
      await db
        .prepare(`SELECT * FROM subscription_events WHERE status = 'pending' AND created_at < ? ORDER BY occurred_at LIMIT 100`)
        .bind(now - STUCK_EVENT_SECONDS)
        .all<SubscriptionEventRow>()
    ).results || []
  for (const row of stuck) {
    const outcome = await processSubscriptionEvent(event, row)
    report.retried_events.push({ id: row.id, status: outcome.status })
  }

  const dueToExpire =
    (
      await db
        .prepare(
          `SELECT * FROM subscriptions
           WHERE status IN ('active', 'trialing', 'past_due')
             AND current_period_end IS NOT NULL AND current_period_end < ?
             AND (cancel_at_period_end = 1 OR status = 'past_due')
           LIMIT 200`,
        )
        .bind(now - EXPIRY_GRACE_SECONDS)
        .all<SubscriptionRow>()
    ).results || []
  for (const sub of dueToExpire) {
    await db
      .prepare(`UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status = ?`)
      .bind(now, sub.id, sub.status)
      .run()
    await syncPlanEntitlements(event, { ...sub, status: 'expired' }, sub.current_period_end)
    report.expired_subscriptions.push(sub.id)
  }

  const subs =
    (
      await db
        .prepare(`SELECT * FROM subscriptions WHERE updated_at > ? OR status IN ('active', 'trialing', 'past_due') LIMIT 1000`)
        .bind(now - 90 * 86400)
        .all<SubscriptionRow & { canceled_at?: number | null }>()
    ).results || []
  for (const sub of subs) {
    const keys = await planKeys(event, sub.plan_id)
    if (!keys.length) continue
    const until = expectedAccessUntil(sub)
    const rows =
      (
        await db
          .prepare(`SELECT entitlement_key, valid_to, status FROM entitlements WHERE subscription_id = ? AND source = 'plan'`)
          .bind(sub.id)
          .all<{ entitlement_key: string; valid_to: number | null; status: string }>()
      ).results || []
    const shouldHaveAccess = until === null || until > sub.started_at
    const drift = keys.some((key) => {
      const row = rows.find((r) => r.entitlement_key === key)
      if (!shouldHaveAccess) return Boolean(row && row.status === 'granted')
      return !row || row.status !== 'granted' || (row.valid_to ?? null) !== until
    })
    if (drift) {
      await syncPlanEntitlements(event, sub, until)
      report.repaired_entitlements.push(sub.id)
    }
    if ((sub.status === 'active' || sub.status === 'trialing') && sub.current_period_end && sub.current_period_end < now - EXPIRY_GRACE_SECONDS && !sub.cancel_at_period_end) {
      report.overdue_without_renewal.push(sub.id)
    }
  }

  const failed = await db.prepare(`SELECT count(*) AS n FROM subscription_events WHERE status = 'failed'`).first<{ n: number }>()
  report.failed_events = Number(failed?.n || 0)

  if (report.failed_events) report.alerts.push(`${report.failed_events} billing event(s) failed to apply — see the admin billing page`)
  if (report.overdue_without_renewal.length) {
    report.alerts.push(`${report.overdue_without_renewal.length} active subscription(s) are past their period with no renewal event`)
  }
  const spikes =
    (
      await db
        .prepare(
          `SELECT tenant_id, count(*) AS n FROM audit_logs
           WHERE action = 'auth.login_failed' AND created_at > ? GROUP BY tenant_id HAVING n > ?`,
        )
        .bind(now - 3600, LOGIN_FAILURE_ALERT_PER_HOUR)
        .all<{ tenant_id: string; n: number }>()
    ).results || []
  for (const spike of spikes) report.alerts.push(`${spike.n} failed sign-ins in the last hour for ${spike.tenant_id}`)

  try {
    report.afdian = await reconcileAfdianOrders(event)
    if (report.afdian?.unmatched) report.alerts.push(`${report.afdian.unmatched} afdian order(s) could not be matched to an account`)
  } catch (error) {
    report.afdian = null
    report.alerts.push(`afdian reconcile failed: ${String((error as Error)?.message || error)}`)
  }
  return report
}
