import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getProviderAvailability } from '../../../utils/provider-policy'
import { getEnv } from '../../../utils/env'
import { isEmailEnabled } from '../../../utils/email'
import { isWechatWebEnabled } from '../../../utils/wechat'

/**
 * GET /api/auth/providers?client_id=…[&siwa=1] — which sign-in buttons the hosted
 * login / register pages show for this client. Server-driven so the Apple and
 * store-client flags flip without rebuilding the pages.
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const clientId = typeof query.client_id === 'string' ? query.client_id.trim() : ''
  setResponseHeader(event, 'cache-control', 'no-store')
  const env = getEnv(event)
  return {
    ...getProviderAvailability(event, { clientId, siwaPreview: query.siwa === '1' }),
    password_reset: isEmailEnabled(env),
    wechat: isWechatWebEnabled(env),
  }
})
