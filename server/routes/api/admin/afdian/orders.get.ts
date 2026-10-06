import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../../utils/env'
import { ensureAfdianSchema } from '../../../../utils/afdian'
import { requirePlatformAdmin } from '../../../../utils/guard'

const STATUSES = new Set(['processing', 'matched', 'unmatched', 'rejected', 'error'])

/** GET /api/admin/afdian/orders?status=unmatched&limit=50 — afdian order ledger (platform admins). */
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  await ensureAfdianSchema(event)
  const query = getQuery(event)
  const status = typeof query.status === 'string' && STATUSES.has(query.status) ? query.status : ''
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const rows =
    (
      await getDb(event)
        .prepare(
          `SELECT out_trade_no, plan_id, afdian_user_id, custom_order_id, month, total_amount, status, reason,
                  global_account_id, tenant_id, user_id, valid_to, via, raw_json, created_at, updated_at
           FROM afdian_orders WHERE (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(status, status, limit)
        .all<Record<string, unknown> & { raw_json: string }>()
    ).results || []
  return {
    orders: rows.map(({ raw_json: raw, ...row }) => {
      let order: unknown = null
      try {
        order = JSON.parse(raw)
      } catch {
        order = null
      }
      return { ...row, order }
    }),
  }
})
