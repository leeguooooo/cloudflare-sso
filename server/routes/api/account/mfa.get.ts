import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { getMfaStatus } from '../../../utils/mfa'

/** GET /api/account/mfa — whether two-step verification is on, and how many recovery codes are left. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  if (!ctx.globalAccount?.id) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  setResponseHeader(event, 'cache-control', 'no-store')
  return getMfaStatus(event, ctx.globalAccount.id)
})
