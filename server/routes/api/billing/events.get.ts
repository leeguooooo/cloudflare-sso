import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { ensureBillingSchema } from '../../../utils/billing'
import { requireTenantAdmin } from '../../../utils/guard'

const STATUSES = new Set(['pending', 'applied', 'ignored', 'failed'])

/** GET /api/billing/events?tenant_id=&status=&limit= — ingested billing events, newest first. */
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
      `SELECT id, provider, event_id, event_type, status, error_message, occurred_at, processed_at, subscription_id
       FROM subscription_events
       WHERE tenant_id = ? AND (? = '' OR status = ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(tenantId, status, status, limit)
    .all()
  return { events: rows.results || [] }
})
