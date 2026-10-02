import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { ensureBillingSchema } from '../../../utils/billing'
import { requireTenantAdmin } from '../../../utils/guard'

const STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'expired'])

/** GET /api/billing/subscriptions?tenant_id=&status=&limit= — the tenant's subscriptions, most recently updated first. */
export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  const status = STATUSES.has(String(query.status)) ? String(query.status) : ''
  const limitRaw = Number(query.limit || 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50

  const rows = await getDb(event)
    .prepare(
      `SELECT s.id, s.user_id, u.email, p.plan_key, p.name AS plan_name, s.provider, s.provider_ref, s.status,
              s.started_at, s.current_period_end, s.cancel_at_period_end, s.canceled_at, s.updated_at
       FROM subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = ? AND (? = '' OR s.status = ?)
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .bind(tenantId, status, status, limit)
    .all()
  return { subscriptions: (rows.results || []).map((row) => ({ ...row, cancel_at_period_end: Boolean((row as { cancel_at_period_end?: number }).cancel_at_period_end) })) }
})
