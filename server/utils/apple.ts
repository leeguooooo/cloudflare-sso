/**
 * Sign in with Apple (web / REST flow).
 *
 * - Authorize: https://appleid.apple.com/auth/authorize with response_type=code,
 *   response_mode=form_post, scope="name email", state and nonce.
 * - Apple POSTs code / id_token / state / user (name, first authorization only) to
 *   the redirect URI registered on the Services ID.
 * - The code is exchanged at /auth/token with client_secret = ES256 JWT signed with
 *   the Sign in with Apple key (.p8). The returned id_token is verified against
 *   Apple's JWKS (RS256, iss, aud = Services ID, exp, nonce).
 * - Refresh tokens are kept so they can be revoked (/auth/revoke) when the user
 *   unlinks Apple or deletes the account (App Store Review Guideline 5.1.1(v)).
 * - Server-to-server notifications (consent-revoked, account-delete, email-disabled,
 *   email-enabled) arrive as {"payload": "<JWT signed by Apple>"}.
 *
 * Everything that talks to Apple takes its base URL from APPLE_AUTH_BASE_URL so the
 * flows can be exercised against a local mock provider.
 */
import { createError, H3Event } from 'h3'
import { base64UrlDecode, base64UrlEncode } from './crypto'
import { getEnv } from './env'

export const APPLE_ISSUER = 'https://appleid.apple.com'
const DEFAULT_APP_IDS = ['com.paste.native']

export type AppleConfig = {
  teamId: string
  servicesId: string
  keyId: string
  privateKey: string
  baseUrl: string
  /** iss expected in Apple's tokens (always https://appleid.apple.com except for the mock). */
  issuer: string
  appIds: string[]
}

const textEncoder = new TextEncoder()

type EnvLike = ReturnType<typeof getEnv>

export const readAppleConfig = (env: EnvLike): AppleConfig | null => {
  const teamId = (env.APPLE_TEAM_ID || '').trim()
  const servicesId = (env.APPLE_SERVICES_ID || '').trim()
  const keyId = (env.APPLE_KEY_ID || '').trim()
  const privateKey = (env.APPLE_PRIVATE_KEY || '').trim()
  if (!teamId || !servicesId || !keyId || !privateKey) return null
  const baseUrl = ((env.APPLE_AUTH_BASE_URL || '').trim() || APPLE_ISSUER).replace(/\/+$/, '')
  const appIds = (env.APPLE_APP_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    teamId,
    servicesId,
    keyId,
    privateKey,
    baseUrl,
    issuer: baseUrl,
    appIds: appIds.length ? appIds : DEFAULT_APP_IDS,
  }
}

export const isAppleConfigured = (env: EnvLike) => readAppleConfig(env) !== null

export const requireAppleConfig = (event: H3Event): AppleConfig => {
  const config = readAppleConfig(getEnv(event))
  if (!config) {
    throw createError({ statusCode: 501, statusMessage: 'Sign in with Apple is not configured' })
  }
  return config
}

export const appleRedirectUri = (event: H3Event, origin: string) => {
  const configured = (getEnv(event).APPLE_REDIRECT_URI || '').trim()
  return configured || `${origin}/api/auth/apple/callback`
}

export const buildAppleAuthorizeUrl = (
  config: AppleConfig,
  input: { redirectUri: string; state: string; nonce: string },
) => {
  const url = new URL(`${config.baseUrl}/auth/authorize`)
  url.searchParams.set('client_id', config.servicesId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  // Requesting scopes requires form_post.
  url.searchParams.set('response_mode', 'form_post')
  url.searchParams.set('scope', 'name email')
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  return url.toString()
}

// ---------------------------------------------------------------------------
// client_secret (ES256 JWT)
// ---------------------------------------------------------------------------

const pemToDer = (pem: string) => {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encodeJson = (value: unknown) => base64UrlEncode(textEncoder.encode(JSON.stringify(value)))

/** client_secret for Apple's token / revoke endpoints. Valid for at most 6 months; we use 5 minutes. */
export const createAppleClientSecret = async (config: AppleConfig, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = encodeJson({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })
  const payload = encodeJson({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: config.issuer,
    sub: config.servicesId,
  })
  const signingInput = `${header}.${payload}`
  // WebCrypto ECDSA signatures are already the raw r||s form JWS wants.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, textEncoder.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

// ---------------------------------------------------------------------------
// JWKS + id_token verification
// ---------------------------------------------------------------------------

type Jwk = JsonWebKey & { kid?: string }
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()
const JWKS_TTL_MS = 60 * 60 * 1000

const fetchJwks = async (config: AppleConfig, force = false): Promise<Jwk[]> => {
  const cached = jwksCache.get(config.baseUrl)
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys
  const response = await fetch(`${config.baseUrl}/auth/keys`, { headers: { accept: 'application/json' } })
  const payload = (await response.json().catch(() => null)) as { keys?: Jwk[] } | null
  if (!response.ok || !Array.isArray(payload?.keys)) {
    throw createError({ statusCode: 502, statusMessage: 'Could not load Apple signing keys' })
  }
  jwksCache.set(config.baseUrl, { keys: payload.keys, fetchedAt: Date.now() })
  return payload.keys
}

export const clearAppleJwksCache = () => jwksCache.clear()

const decodeJson = (segment: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)))

const invalid = (message: string) => createError({ statusCode: 401, statusMessage: `Invalid Apple token: ${message}` })

/** Verifies an Apple-signed JWT (id_token or notification payload) and returns its claims. */
export const verifyAppleJwt = async (
  config: AppleConfig,
  token: string,
  expected: { audiences: string[]; nonce?: string; nowSeconds?: number },
): Promise<Record<string, unknown>> => {
  const parts = token.split('.')
  if (parts.length !== 3) throw invalid('malformed')
  let header: { alg?: string; kid?: string }
  let claims: Record<string, unknown>
  try {
    header = decodeJson(parts[0])
    claims = decodeJson(parts[1])
  } catch {
    throw invalid('malformed')
  }
  if (header.alg !== 'RS256' || !header.kid) throw invalid('unexpected header')

  let jwk = (await fetchJwks(config)).find((key) => key.kid === header.kid)
  if (!jwk) jwk = (await fetchJwks(config, true)).find((key) => key.kid === header.kid)
  if (!jwk) throw invalid('unknown key')

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlDecode(parts[2]),
    textEncoder.encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) throw invalid('bad signature')

  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (claims.iss !== config.issuer) throw invalid('issuer')
  const aud = claims.aud
  const audiences = Array.isArray(aud) ? aud : [aud]
  if (!audiences.some((item) => typeof item === 'string' && expected.audiences.includes(item))) throw invalid('audience')
  if (typeof claims.exp === 'number' && now > claims.exp + 60) throw invalid('expired')
  if (expected.nonce !== undefined && claims.nonce !== expected.nonce) throw invalid('nonce')
  return claims
}

/** Apple sends booleans either as JSON booleans or as the strings "true" / "false". */
export const appleBool = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export type AppleIdentity = {
  subject: string
  email?: string
  emailVerified: boolean
  isPrivateEmail: boolean
  name?: string
  refreshToken?: string
  claims: Record<string, unknown>
}

/** The `user` form field Apple posts on the FIRST authorization only. */
export const parseAppleUserField = (raw: unknown): { name?: string; email?: string } => {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string }; email?: string }
    const first = (parsed.name?.firstName || '').trim()
    const last = (parsed.name?.lastName || '').trim()
    const name = [first, last].filter(Boolean).join(' ')
    return { name: name || undefined, email: typeof parsed.email === 'string' ? parsed.email : undefined }
  } catch {
    return {}
  }
}

export const exchangeAppleCode = async (
  config: AppleConfig,
  input: { code: string; redirectUri: string; nonce?: string; userField?: unknown },
): Promise<AppleIdentity> => {
  const body = new URLSearchParams()
  body.set('client_id', config.servicesId)
  body.set('client_secret', await createAppleClientSecret(config))
  body.set('code', input.code)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', input.redirectUri)
  const response = await fetch(`${config.baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  const payload = (await response.json().catch(() => null)) as {
    id_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  } | null
  if (!response.ok || !payload?.id_token) {
    throw createError({
      statusCode: 401,
      statusMessage: payload?.error_description || payload?.error || 'Failed to exchange Apple code',
    })
  }
  const claims = await verifyAppleJwt(config, payload.id_token, { audiences: [config.servicesId], nonce: input.nonce })
  const subject = typeof claims.sub === 'string' ? claims.sub : ''
  if (!subject) throw invalid('missing subject')
  const user = parseAppleUserField(input.userField)
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : undefined
  return {
    subject,
    email: email || undefined,
    emailVerified: appleBool(claims.email_verified) ?? false,
    isPrivateEmail: appleBool(claims.is_private_email) ?? Boolean(email?.endsWith('@privaterelay.appleid.com')),
    name: user.name,
    refreshToken: payload.refresh_token || undefined,
    claims,
  }
}

/** Best effort: Apple answers 200 for unknown / already revoked tokens too. */
export const revokeAppleToken = async (config: AppleConfig, refreshToken: string) => {
  const body = new URLSearchParams()
  body.set('client_id', config.servicesId)
  body.set('client_secret', await createAppleClientSecret(config))
  body.set('token', refreshToken)
  body.set('token_type_hint', 'refresh_token')
  const response = await fetch(`${config.baseUrl}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  return response.ok
}

export type AppleNotificationEvent = {
  type: 'email-disabled' | 'email-enabled' | 'consent-revoked' | 'account-delete' | string
  sub: string
  email?: string
  isPrivateEmail?: boolean
  eventTime?: number
}

/** Verifies the notification JWT; `aud` is the primary App ID (or the Services ID). */
export const verifyAppleNotification = async (config: AppleConfig, payloadJwt: string): Promise<AppleNotificationEvent> => {
  const claims = await verifyAppleJwt(config, payloadJwt, { audiences: [...config.appIds, config.servicesId] })
  let events = claims.events as unknown
  if (typeof events === 'string') {
    try {
      events = JSON.parse(events)
    } catch {
      throw invalid('events')
    }
  }
  const record = (events || {}) as Record<string, unknown>
  const sub = typeof record.sub === 'string' ? record.sub : ''
  const type = typeof record.type === 'string' ? record.type : ''
  if (!sub || !type) throw invalid('events')
  return {
    type,
    sub,
    email: typeof record.email === 'string' ? record.email : undefined,
    isPrivateEmail: appleBool(record.is_private_email),
    eventTime: typeof record.event_time === 'number' ? record.event_time : undefined,
  }
}

/** Placeholder address for an Apple account that never shared an email. */
export const syntheticAppleEmail = async (subject: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(`apple:${subject}`))
  const hex = [...new Uint8Array(digest)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `apple-${hex}@users.account.invalid`
}
