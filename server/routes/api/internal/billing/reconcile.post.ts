import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { getEnv } from '../../../../utils/env'
import { timingSafeEqual } from '../../../../utils/oauth-error'
import { reconcileBilling } from '../../../../utils/reconcile'
import { writeAuditLog } from '../../../../utils/audit'
import { retryDueDeliveries } from '../../../../utils/webhooks'

/**
 * POST /api/internal/billing/reconcile — called on a schedule by workers/billing-reconcile
 * (Pages Functions have no cron). Authenticated with the shared RECONCILE_SECRET. Also retries
 * due webhook deliveries.
 */
export default defineEventHandler(async (event) => {
  const secret = getEnv(event).RECONCILE_SECRET || ''
  const presented = (getRequestHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  if (!secret || !presented || !(await timingSafeEqual(presented, secret))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const report = await reconcileBilling(event)
  // Same schedule retries webhook deliveries that failed their first attempt.
  const webhooks = await retryDueDeliveries(event).catch((error) => ({ attempted: 0, succeeded: 0, error: String(error) }))
  await writeAuditLog(event, {
    tenantId: null,
    userId: null,
    action: 'billing.reconcile',
    payload: {
      expired: report.expired_subscriptions.length,
      repaired: report.repaired_entitlements.length,
      retried: report.retried_events.length,
      failed_events: report.failed_events,
      alerts: report.alerts,
      webhooks,
    },
  })
  return { ...report, webhooks }
})
