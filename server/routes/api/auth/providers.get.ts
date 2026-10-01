import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getProviderAvailability } from '../../../utils/provider-policy'

/**
 * GET /api/auth/providers?client_id=…[&siwa=1] — which sign-in buttons the hosted
 * login / register pages show for this client. Server-driven so the Apple and
 * store-client flags flip without rebuilding the pages.
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const clientId = typeof query.client_id === 'string' ? query.client_id.trim() : ''
  setResponseHeader(event, 'cache-control', 'no-store')
  return getProviderAvailability(event, { clientId, siwaPreview: query.siwa === '1' })
})
