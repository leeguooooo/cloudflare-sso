import { defineEventHandler, H3Event, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { getEnv } from '../../../../utils/env'
import { afdianPlanForApp, createAfdianCheckout } from '../../../../utils/afdian'
import { getBrowserSessionAccount, isSameOriginRequest } from '../../../../utils/browser-session'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'

const fail = (event: H3Event, status: number, error: string, description: string) => {
  setResponseStatus(event, status)
  return { error, error_description: description }
}

/**
 * POST /api/billing/afdian/checkout { app_key, month } — starts an afdian purchase for the
 * browser's signed-in account (session cookie only) and returns the afdian order URL.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  if (!isSameOriginRequest(event)) return fail(event, 403, 'invalid_origin', 'Cross-origin request refused')
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { app_key?: unknown; month?: unknown }
  const appKey = typeof body.app_key === 'string' ? body.app_key.trim().toLowerCase() : ''
  const month = Number(body.month ?? 1)
  if (!appKey || !Number.isInteger(month) || month < 1 || month > 12) {
    return fail(event, 400, 'invalid_request', 'app_key and month (1-12) are required')
  }
  const plan = afdianPlanForApp(getEnv(event), appKey)
  if (!plan) return fail(event, 404, 'not_available', 'Membership purchase is not available for this app yet')

  try {
    await consumeRateLimit(event, 'afdian_checkout', requestIp(event), 30, 600)
  } catch {
    return fail(event, 429, 'too_many_requests', 'Too many attempts, try again later')
  }
  const account = await getBrowserSessionAccount(event)
  if (!account) return fail(event, 401, 'login_required', 'Sign in first')
  if (!account.globalAccountId) return fail(event, 403, 'account_unavailable', 'This account cannot buy memberships')

  const checkout = await createAfdianCheckout(event, { globalAccountId: account.globalAccountId, plan, month })
  return { url: checkout.url, checkout_id: checkout.id, month }
})
