import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3'
import { getEnv } from '../../../../utils/env'
import { ensureGlobalIdentitySchema, getClientByPublicId } from '../../../../utils/identity'
import { exchangeMiniProgramCode } from '../../../../utils/wechat'
import { resolveLoginAccount, signInAccount } from '../../../../utils/oauth-complete'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * POST /api/auth/wechat/miniprogram { client_id, code } — exchanges a wx.login() code for SSO
 * tokens (same shape as /token). The client must be mapped to its appid in WECHAT_MINIPROGRAMS.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { client_id?: string; code?: string }
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!clientId || !code) throw createError({ statusCode: 400, statusMessage: 'client_id and code are required' })
  await consumeRateLimit(event, 'wechat_mp', requestIp(event), 60, 600)

  await ensureGlobalIdentitySchema(event)
  const client = await getClientByPublicId(event, clientId)
  const profile = await exchangeMiniProgramCode(getEnv(event), client.client_id, code)
  const account = await resolveLoginAccount(event, profile)
  const { provisioned, tokens } = await signInAccount(event, client, account, profile)

  await writeAuditLog(event, {
    tenantId: provisioned.user.tenant_id,
    userId: provisioned.user.id,
    action: 'auth.wechat_miniprogram',
    payload: { client_id: client.client_id, global_account_id: account.id, provisioned_created: provisioned.created },
  })

  return {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.accessTokenExpiresIn,
    scope: client.scope || 'openid profile email',
  }
})
