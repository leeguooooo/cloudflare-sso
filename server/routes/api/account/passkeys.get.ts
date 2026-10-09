import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { listPasskeys, rpIdFor } from '../../../utils/passkeys'

/** GET /api/account/passkeys — the account's passkeys (no key material) and the RP ID they work on. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  if (!ctx.globalAccount?.id) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  setResponseHeader(event, 'cache-control', 'no-store')
  return { rp_id: rpIdFor(event), passkeys: await listPasskeys(event, ctx.globalAccount.id) }
})
