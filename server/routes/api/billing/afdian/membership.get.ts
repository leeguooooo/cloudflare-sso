import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getEnv } from '../../../../utils/env'
import { afdianPlanForApp, membershipStatus } from '../../../../utils/afdian'
import { getBrowserSessionAccount } from '../../../../utils/browser-session'

/**
 * GET /api/billing/afdian/membership?app_key= — what /membership/<app_key> shows: who is signed
 * in (session cookie), whether the app sells memberships, and the account's current status.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const appKey = String(getQuery(event).app_key || '').trim().toLowerCase()
  const account = await getBrowserSessionAccount(event)
  const plan = appKey ? afdianPlanForApp(getEnv(event), appKey) : undefined
  const base = {
    signed_in: Boolean(account),
    email: account?.email || null,
    app_key: appKey,
    available: Boolean(plan),
    name: plan?.name || null,
    price_label: plan?.price_label || null,
  }
  if (!account?.globalAccountId || !plan) return { ...base, status: 'none', valid_to: null }
  return { ...base, ...(await membershipStatus(event, account.globalAccountId, plan)) }
})
