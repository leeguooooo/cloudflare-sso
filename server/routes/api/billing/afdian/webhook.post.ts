import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { getEnv } from '../../../../utils/env'
import {
  AFDIAN_PUBLIC_KEY,
  isAfdianApiConfigured,
  processAfdianOrder,
  queryAfdianOrders,
  rejectAfdianOrder,
  verifyAfdianSignature,
  type AfdianOrder,
} from '../../../../utils/afdian'
import { writeAuditLog } from '../../../../utils/audit'

type WebhookBody = { ec?: number; data?: { type?: string; order?: AfdianOrder; sign?: string } }

const sameAmount = (a: unknown, b: unknown) => Number(a) === Number(b)

/**
 * POST /api/billing/afdian/webhook — afdian's order push. afdian only stops retrying on
 * `{ "ec": 200 }`, so anything final (applied, duplicate, unmatched, refused) answers 200;
 * a transient failure answers ec 500 so the order is pushed again.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as WebhookBody
  const order = body.data?.order
  if (body.data?.type !== 'order' || !order || typeof order !== 'object' || !order.out_trade_no) return { ec: 200, em: '' }

  const env = getEnv(event)
  const publicKey = (env.AFDIAN_PUBLIC_KEY || '').trim() || AFDIAN_PUBLIC_KEY
  if (!(await verifyAfdianSignature(order, String(body.data?.sign || ''), publicKey))) {
    console.warn('afdian webhook signature rejected', { out_trade_no: String(order.out_trade_no) })
    setResponseStatus(event, 401)
    return { ec: 401, em: 'invalid signature' }
  }

  try {
    let trusted = order
    if (isAfdianApiConfigured(env)) {
      const { list } = await queryAfdianOrders(env, { out_trade_no: String(order.out_trade_no) })
      const remote = list.find((item) => String(item.out_trade_no) === String(order.out_trade_no))
      // Not visible through the API yet: let afdian push it again (reconcile catches it too).
      if (!remote) return { ec: 500, em: 'order not found via api yet' }
      if (!sameAmount(remote.total_amount, order.total_amount) || String(remote.plan_id) !== String(order.plan_id) || String(remote.user_id) !== String(order.user_id)) {
        await rejectAfdianOrder(event, order, 'webhook', 'api_mismatch')
        return { ec: 200, em: '' }
      }
      trusted = { ...order, ...remote }
    }
    const outcome = await processAfdianOrder(event, trusted, { via: 'webhook' })
    if (outcome.status !== 'duplicate') {
      await writeAuditLog(event, {
        tenantId: null,
        userId: null,
        action: `billing.afdian.${outcome.status}`,
        payload: { out_trade_no: String(order.out_trade_no), reason: outcome.reason || null, global_account_id: outcome.global_account_id || null },
      }).catch(() => undefined)
    }
    return { ec: 200, em: '' }
  } catch (error) {
    console.error('afdian webhook failed', { out_trade_no: String(order.out_trade_no), error: String((error as Error)?.message || error) })
    return { ec: 500, em: 'retry later' }
  }
})
