import { defineEventHandler, getRequestHeader, readBody, setResponseHeader } from 'h3'
import { getDb, getEnv } from '../../utils/env'
import { getIssuer } from '../../utils/auth'
import { ensureClientManagementSchema } from '../../utils/identity'
import { OAuthError, readClientCredentials, sendOAuthError } from '../../utils/oauth-error'
import { verifyClientSecret } from '../../utils/client-auth'
import { consumeRateLimit, requestIp } from '../../utils/rate-limit'
import { createDeviceCode, DEVICE_CODE_GRANT, formatUserCode } from '../../utils/device'

const splitList = (value: string | null | undefined) => (value || '').split(/[\s,]+/).filter(Boolean)

/**
 * POST /device/code — RFC 8628 §3.1 device authorization request (form or JSON body):
 * `client_id`, optional `scope`. Only clients whose grant_types list the device_code grant.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
    const { clientId, clientSecret } = readClientCredentials(getRequestHeader(event, 'authorization'), body)
    if (!clientId) throw new OAuthError('invalid_request', 'client_id required')
    await consumeRateLimit(event, 'device_code', requestIp(event), 30, 600)

    await ensureClientManagementSchema(event)
    const client = await getDb(event)
      .prepare(`SELECT id, client_secret, grant_types, scope, status FROM clients WHERE client_id = ?`)
      .bind(clientId)
      .first<{ id: string; client_secret: string | null; grant_types?: string | null; scope: string; status?: string | null }>()
    if (!client) throw new OAuthError('invalid_client', 'Unknown client')
    if ((client.status || 'active') !== 'active') throw new OAuthError('invalid_client', 'Client disabled')
    if (client.client_secret && !(await verifyClientSecret(clientSecret, client.client_secret))) {
      throw new OAuthError('invalid_client', 'Invalid client secret')
    }
    if (!splitList(client.grant_types).includes(DEVICE_CODE_GRANT)) {
      throw new OAuthError('unauthorized_client', 'The device_code grant is not enabled for this client')
    }

    // Scopes the client is not registered for are dropped; the token response reports what was granted.
    const allowed = splitList(client.scope || 'openid profile email')
    const requested = typeof body.scope === 'string' ? splitList(body.scope).filter((scope) => allowed.includes(scope)) : []
    const scope = (requested.length ? requested : allowed).join(' ')

    const created = await createDeviceCode(event, {
      clientInternalId: client.id,
      scope,
      ip: requestIp(event),
      userAgent: getRequestHeader(event, 'user-agent') || '',
    })
    const verificationUri = `${getIssuer(event, getEnv(event))}/device`
    const userCode = formatUserCode(created.userCode)
    return {
      device_code: created.deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?user_code=${userCode}`,
      expires_in: created.expiresIn,
      interval: created.interval,
    }
  } catch (error) {
    if (error instanceof OAuthError) return sendOAuthError(event, error)
    if ((error as { statusCode?: number })?.statusCode === 429) {
      return sendOAuthError(event, new OAuthError('slow_down', 'Too many requests, try again later', 429))
    }
    throw error
  }
})
