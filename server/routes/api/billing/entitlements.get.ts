import { defineEventHandler } from 'h3'
import { getDb } from '../../../utils/env'
import { resolveEntitlementTarget } from '../../../utils/entitlement-access'

type EntitlementRow = {
  id: string
  entitlement_key: string
  source: string
  status: string
  valid_from: number
  valid_to: number | null
  subscription_id: string | null
  plan_key: string | null
  plan_name: string | null
  product_key: string | null
  app_key: string | null
  meta_json?: string | null
}

const parseMeta = (raw: string | null | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export default defineEventHandler(async (event) => {
  const { tenantId, targetUserId, asOf, query } = await resolveEntitlementTarget(event)
  const includeInactive = String(query.include_inactive || '') === 'true'
  const db = getDb(event)

  const entitlements = await db
    .prepare(
      `SELECT
         e.id,
         e.entitlement_key,
         e.source,
         e.status,
         e.valid_from,
         e.valid_to,
         e.subscription_id,
         e.meta_json,
         p.plan_key AS plan_key,
         p.name AS plan_name,
         pr.product_key AS product_key,
         pr.app_key AS app_key
       FROM entitlements e
       LEFT JOIN subscriptions s ON s.id = e.subscription_id
       LEFT JOIN plans p ON p.id = s.plan_id
       LEFT JOIN products pr ON pr.id = p.product_id
       WHERE e.tenant_id = ?
         AND e.user_id = ?
         AND e.valid_from <= ?
         AND (e.valid_to IS NULL OR e.valid_to > ?)
         AND (? = 1 OR e.status = 'granted')
       ORDER BY e.valid_from DESC`,
    )
    .bind(tenantId, targetUserId, Math.floor(asOf), Math.floor(asOf), includeInactive ? 1 : 0)
    .all<EntitlementRow>()

  const rows = (entitlements.results || []).map(({ meta_json: metaJson, ...row }) => {
    const meta = parseMeta(metaJson)
    return { ...row, trial: meta.trial === true, provider: typeof meta.provider === 'string' ? meta.provider : null }
  })
  const activeEntitlementKeys = [...new Set(rows.filter((item) => item.status === 'granted').map((item) => item.entitlement_key))]

  // The latest lapsed grant of every key the user no longer has, so apps can say "expired".
  const lapsed =
    (
      await db
        .prepare(
          `SELECT entitlement_key, source, max(valid_to) AS valid_to, meta_json FROM entitlements
           WHERE tenant_id = ? AND user_id = ? AND status = 'granted' AND valid_to IS NOT NULL AND valid_to <= ?
           GROUP BY entitlement_key ORDER BY valid_to DESC`,
        )
        .bind(tenantId, targetUserId, Math.floor(asOf))
        .all<{ entitlement_key: string; source: string; valid_to: number; meta_json: string | null }>()
    ).results || []
  const expiredEntitlements = lapsed
    .filter((row) => !activeEntitlementKeys.includes(row.entitlement_key))
    .map(({ meta_json: metaJson, ...row }) => {
      const meta = parseMeta(metaJson)
      return { ...row, trial: meta.trial === true, provider: typeof meta.provider === 'string' ? meta.provider : null }
    })

  return {
    tenant_id: tenantId,
    user_id: targetUserId,
    as_of: Math.floor(asOf),
    active_entitlement_keys: activeEntitlementKeys,
    entitlements: rows,
    expired_entitlements: expiredEntitlements,
  }
})
