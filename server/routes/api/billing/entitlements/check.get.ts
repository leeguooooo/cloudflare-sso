import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { resolveEntitlementTarget } from '../../../../utils/entitlement-access'
import { recordEntitlementCheck } from '../../../../utils/entitlement-metrics'

/**
 * GET /api/billing/entitlements/check?entitlement_key=[&user_id=&tenant_id=&as_of=] — may this
 * user use this feature right now? Same auth as GET /api/billing/entitlements. Answers
 * `{ allowed, entitlement_key, source, trial, valid_to }` and counts the answer per app for the
 * admin console's allow/deny rates, so apps should gate features through this call.
 */
export default defineEventHandler(async (event) => {
  const { tenantId, targetUserId, asOf, clientId, query } = await resolveEntitlementTarget(event)
  const key = String(query.entitlement_key || '').trim()
  if (!key) throw createError({ statusCode: 400, statusMessage: 'entitlement_key required' })
  setResponseHeader(event, 'cache-control', 'no-store')

  const row = await getDb(event)
    .prepare(
      `SELECT source, valid_to, meta_json FROM entitlements
       WHERE tenant_id = ? AND user_id = ? AND entitlement_key = ? AND status = 'granted'
         AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
       ORDER BY (valid_to IS NULL) DESC, valid_to DESC
       LIMIT 1`,
    )
    .bind(tenantId, targetUserId, key, asOf, asOf)
    .first<{ source: string; valid_to: number | null; meta_json: string | null }>()

  let trial = false
  try {
    trial = JSON.parse(row?.meta_json || '{}').trial === true
  } catch {
    trial = false
  }
  // Counted after the response when the runtime allows it; the write never delays the answer.
  const metric = recordEntitlementCheck(event, { tenantId, clientId, entitlementKey: key, allowed: Boolean(row) })
  const waitUntil = (event as { waitUntil?: (task: Promise<unknown>) => void }).waitUntil
  if (typeof waitUntil === 'function') waitUntil.call(event, metric)
  else await metric
  return {
    allowed: Boolean(row),
    entitlement_key: key,
    source: row?.source ?? null,
    trial,
    valid_to: row?.valid_to ?? null,
  }
})
