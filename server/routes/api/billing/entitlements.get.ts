import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { ensureBillingSchema } from '../../../utils/billing'
import { requireAccessPrincipal } from '../../../utils/guard'

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
}

const isAdminPrincipal = (principal: { roles: string[]; perms: string[] }) => {
  return (
    principal.roles.includes('admin') ||
    principal.perms.includes('manage:users') ||
    principal.perms.includes('manage:admin')
  )
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const principal = await requireAccessPrincipal(event)
  const query = getQuery(event)

  const tenantId = String(query.tenant_id || principal.tid)
  const targetUserId = String(query.user_id || principal.sub)
  const asOf = query.as_of ? Number(query.as_of) : Math.floor(Date.now() / 1000)
  const includeInactive = String(query.include_inactive || '') === 'true'

  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  if (!targetUserId) {
    throw createError({ statusCode: 400, statusMessage: 'user_id required' })
  }
  if (!Number.isFinite(asOf) || asOf <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'as_of must be a unix timestamp' })
  }
  if (tenantId !== principal.tid) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }
  if (targetUserId !== principal.sub && !isAdminPrincipal(principal)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin required for cross-user entitlement query' })
  }

  const db = getDb(event)
  const user = await db
    .prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`)
    .bind(targetUserId, tenantId)
    .first<{ id: string }>()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found in tenant' })
  }

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

  const rows = entitlements.results || []
  const activeEntitlementKeys = [...new Set(rows.filter((item) => item.status === 'granted').map((item) => item.entitlement_key))]

  return {
    tenant_id: tenantId,
    user_id: targetUserId,
    as_of: Math.floor(asOf),
    active_entitlement_keys: activeEntitlementKeys,
    entitlements: rows,
  }
})
