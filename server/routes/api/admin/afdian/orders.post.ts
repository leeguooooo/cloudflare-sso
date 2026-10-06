import { createError, defineEventHandler, readBody } from 'h3'
import { findAfdianOrder, processAfdianOrder, type AfdianOrder } from '../../../../utils/afdian'
import { findGlobalAccountByEmail, findGlobalAccountById } from '../../../../utils/identity'
import { requirePlatformAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/admin/afdian/orders { out_trade_no, global_account_id | email } — applies an
 * unmatched afdian order to an account and remembers the afdian user for its later orders.
 */
export default defineEventHandler(async (event) => {
  const principal = await requirePlatformAdmin(event)
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { out_trade_no?: unknown; global_account_id?: unknown; email?: unknown }
  const outTradeNo = typeof body.out_trade_no === 'string' ? body.out_trade_no.trim() : ''
  if (!outTradeNo) throw createError({ statusCode: 400, statusMessage: 'out_trade_no required' })
  const account =
    typeof body.global_account_id === 'string' && body.global_account_id.trim()
      ? await findGlobalAccountById(event, body.global_account_id.trim())
      : typeof body.email === 'string' && body.email.trim()
        ? await findGlobalAccountByEmail(event, body.email.trim())
        : null
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })

  const stored = await findAfdianOrder(event, outTradeNo)
  if (!stored) throw createError({ statusCode: 404, statusMessage: 'Order not found' })
  if (stored.status !== 'unmatched' && stored.status !== 'error') {
    throw createError({ statusCode: 409, statusMessage: `Order is ${stored.status}` })
  }
  const order = JSON.parse(stored.raw_json) as AfdianOrder
  const outcome = await processAfdianOrder(event, order, { via: 'admin', globalAccountId: account.id })
  await writeAuditLog(event, {
    tenantId: principal.tid,
    userId: principal.sub,
    action: 'admin.billing.afdian_bind',
    payload: { out_trade_no: outTradeNo, global_account_id: account.id, outcome: outcome.status },
  })
  return outcome
})
