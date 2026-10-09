import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { getPreferences } from '../../../utils/sign-in-alerts'

/** GET /api/account/preferences → `{ sign_in_alerts }` (new-device sign-in emails, on by default). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  if (!ctx.globalAccount?.id) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  setResponseHeader(event, 'cache-control', 'no-store')
  return getPreferences(event, ctx.globalAccount.id)
})
