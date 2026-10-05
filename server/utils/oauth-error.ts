import { H3Event, setResponseHeader, setResponseStatus } from 'h3'

/** RFC 6749 §5.2 (and RFC 8628 §3.5 device flow) error codes used by the token / revocation endpoints. */
export type OAuthErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'unsupported_token_type'

export class OAuthError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly status = error === 'invalid_client' ? 401 : 400,
  ) {
    super(description)
  }
}

/** Writes `{ error, error_description }` the way OAuth client libraries expect. */
export const sendOAuthError = (event: H3Event, failure: OAuthError) => {
  setResponseStatus(event, failure.status)
  setResponseHeader(event, 'cache-control', 'no-store')
  if (failure.status === 401) setResponseHeader(event, 'www-authenticate', 'Basic realm="token"')
  return { error: failure.error, error_description: failure.description }
}

const encoder = new TextEncoder()

/** Constant-time string comparison (hash first so lengths never leak). */
export const timingSafeEqual = async (a: string, b: string) => {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const l = new Uint8Array(left)
  const r = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < l.length; i += 1) diff |= l[i] ^ r[i]
  return diff === 0
}

export type ClientCredentials = { clientId?: string; clientSecret?: string }

/** client_id / client_secret from HTTP Basic (RFC 6749 §2.3.1, form-urlencoded parts) or the body. */
export const readClientCredentials = (authHeader: string | undefined, body: Record<string, unknown>): ClientCredentials => {
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice('Basic '.length).trim())
      const separator = decoded.indexOf(':')
      if (separator > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        }
      }
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic authorization header')
    }
  }
  return {
    clientId: typeof body.client_id === 'string' ? body.client_id : undefined,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
  }
}
