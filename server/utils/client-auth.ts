import { H3Event } from 'h3'
import { getIssuer } from './auth'
import { base64UrlEncode, randomId } from './crypto'
import { getEnv } from './env'
import { signJwt } from './jwt'
import { writeAuditLog } from './audit'
import { OAuthError, timingSafeEqual } from './oauth-error'

const SECRET_PREFIX = 'sha256$'

const sha256 = async (value: string) =>
  base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))

/** Client secrets are high-entropy random strings, so a plain SHA-256 is enough to store them. */
export const hashClientSecret = async (secret: string) => `${SECRET_PREFIX}${await sha256(secret)}`

export const generateClientSecret = () => randomId(32)

/** Accepts hashed secrets and, for clients created before hashing, legacy plaintext ones. */
export const verifyClientSecret = async (presented: string | undefined, stored: string) => {
  if (!presented) return false
  if (stored.startsWith(SECRET_PREFIX)) return timingSafeEqual(await hashClientSecret(presented), stored)
  return timingSafeEqual(presented, stored)
}

const splitList = (value: string | null | undefined) => (value || '').split(/[\s,]+/).filter(Boolean)

/** Scopes a service token may carry; they never include the OIDC user scopes. */
const SERVICE_SCOPE = /^[a-z][a-z0-9_.-]*:[a-z0-9_.:-]+$/

/**
 * RFC 6749 §4.4. Only confidential clients whose grant_types list client_credentials qualify.
 * The token has no user: `sub` is `client:<client_id>` and `client_only` is true.
 */
export const issueClientCredentialsToken = async (
  event: H3Event,
  client: { id: string; tenant_id: string; client_secret: string | null; grant_types?: string | null; scope: string },
  clientId: string,
  requestedScope: string | undefined,
) => {
  if (!client.client_secret) throw new OAuthError('unauthorized_client', 'client_credentials requires a confidential client')
  if (!splitList(client.grant_types).includes('client_credentials')) {
    throw new OAuthError('unauthorized_client', 'client_credentials is not enabled for this client')
  }
  const allowed = splitList(client.scope).filter((scope) => SERVICE_SCOPE.test(scope))
  const requested = requestedScope ? splitList(requestedScope) : allowed
  const denied = requested.filter((scope) => !allowed.includes(scope))
  if (denied.length) throw new OAuthError('invalid_scope', `Scope not allowed for this client: ${denied.join(' ')}`)

  const env = getEnv(event)
  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS || 600)
  const scope = requested.join(' ')
  const accessToken = await signJwt(
    event,
    {
      sub: `client:${clientId}`,
      tid: client.tenant_id,
      client_id: clientId,
      client_only: true,
      scope,
      token_use: 'access',
      roles: [],
      perms: [],
      jti: crypto.randomUUID(),
    },
    { expiresInSeconds: ttl, issuer: getIssuer(event, env), audience: clientId },
  )

  await writeAuditLog(event, {
    tenantId: client.tenant_id,
    userId: null,
    action: 'auth.token.client_credentials',
    payload: { client_id: clientId, scope },
  })

  return { token_type: 'Bearer', access_token: accessToken, expires_in: ttl, scope }
}
