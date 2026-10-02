import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { getEnv } from '../../../../utils/env'
import { timingSafeEqual } from '../../../../utils/oauth-error'
import { reconcileBilling } from '../../../../utils/reconcile'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/internal/billing/reconcile — called on a schedule by workers/billing-reconcile
 * (Pages Functions have no cron). Authenticated with the shared RECONCILE_SECRET.
 */
export default defineEventHandler(async (event) => {
  const secret = getEnv(event).RECONCILE_SECRET || ''
  const presented = (getRequestHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  if (!secret || !presented || !(await timingSafeEqual(presented, secret))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const report = await reconcileBilling(event)
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
    },
  })
  return report
})
