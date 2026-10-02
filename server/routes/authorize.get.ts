import { createError, defineEventHandler, deleteCookie, getCookie, getQuery, getRequestHeader, getRequestIP, getRequestURL, H3Event, sendRedirect } from 'h3'
import { assertUserActive, ensureSessionSchema, getSessionByRefreshToken } from '../utils/auth'
import { getDb } from '../utils/env'
import { ensureClientManagementSchema } from '../utils/identity'
import { nowInSeconds, randomId } from '../utils/crypto'
import { normalizeRedirectUriForMatch } from '../utils/redirect-uri'

/** Once redirect_uri is validated, errors go back to the client (RFC 6749 §4.1.2.1), not to the user. */
const redirectError = (event: H3Event, redirectUri: string, state: string | undefined, error: string, description: string) => {
  const target = new URL(redirectUri)
  target.searchParams.set('error', error)
  target.searchParams.set('error_description', description)
  if (state) target.searchParams.set('state', state)
  return sendRedirect(event, target.toString(), 302)
}

const loginRedirect = (event: H3Event, clientId: string, reauth: boolean) => {
  // prompt=login / max_age are satisfied by signing in again, so they must not survive into the
  // continue URL or /authorize would ask for a sign-in forever.
  const requestUrl = getRequestURL(event)
  const params = new URLSearchParams(requestUrl.search)
  params.delete('prompt')
  params.delete('max_age')
  const continuePath = `${requestUrl.pathname}?${params.toString()}`
  const loginPath = `/login?continue=${encodeURIComponent(continuePath)}&client_id=${encodeURIComponent(clientId)}${reauth ? '&reauth=1' : ''}`
  return sendRedirect(event, loginPath, 302)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientId = String(query.client_id || '')
  const redirectUriRaw = String(query.redirect_uri || '')
  const redirectUri = normalizeRedirectUriForMatch(redirectUriRaw)
  if (!clientId || !redirectUri) {
    throw createError({ statusCode: 400, statusMessage: 'client_id and redirect_uri are required' })
  }

  const db = getDb(event)
  await ensureClientManagementSchema(event)
  await ensureSessionSchema(event)
  const client = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<{
    id: string
    tenant_id: string
    redirect_uris: string
    client_secret?: string | null
    status?: string
  }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Unknown client' })
  if ((client.status || 'active') !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Client disabled' })
  }

  const allowedRedirects = (JSON.parse(client.redirect_uris || '[]') as string[]).map((item) =>
    normalizeRedirectUriForMatch(item),
  )
  if (!allowedRedirects.includes(redirectUri)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid redirect_uri' })
  }

  const state = query.state ? String(query.state) : undefined
  const fail = (error: string, description: string) => redirectError(event, redirectUriRaw.trim(), state, error, description)

  if (query.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code')
  const scope = String(query.scope || 'openid profile email')
  const nonce = query.nonce ? String(query.nonce) : undefined
  const prompts = new Set(String(query.prompt || '').split(' ').filter(Boolean))
  const maxAge = query.max_age !== undefined && query.max_age !== '' ? Number(query.max_age) : undefined
  const codeChallenge = query.code_challenge ? String(query.code_challenge) : undefined
  const codeChallengeMethod = String(query.code_challenge_method || 'S256')
  if (codeChallengeMethod !== 'S256') return fail('invalid_request', 'Only PKCE S256 is supported')
  if (!codeChallenge && !client.client_secret) return fail('invalid_request', 'code_challenge is required (PKCE S256)')
  if (codeChallenge && !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return fail('invalid_request', 'Malformed code_challenge')
  if (maxAge !== undefined && (!Number.isFinite(maxAge) || maxAge < 0)) return fail('invalid_request', 'Invalid max_age')
  if (prompts.has('none') && prompts.size > 1) return fail('invalid_request', 'prompt=none cannot be combined')

  // Only the first-party session cookie counts as being signed in here. A bearer token is not
  // accepted: anyone holding a leaked access or id token could otherwise mint fresh sessions.
  let userId = ''
  let tenantId = ''
  let authTime = 0
  const refreshToken = getCookie(event, 'sso_refresh_token')
  if (refreshToken) {
    const session = await getSessionByRefreshToken(event, refreshToken)
    if (session) {
      userId = session.user_id
      tenantId = session.tenant_id
      authTime = Number(session.auth_time || session.created_at || 0)
    }
  }

  // The session cookie is shared across every client on this host, so a user who last
  // signed in through another tenant's client arrives here with a foreign session.
  // Accounts are global (per-tenant users are provisioned on login), so treat this as
  // "not signed in for this client" and re-authenticate instead of dead-ending.
  let tenantSwitch = false
  if (userId && tenantId && tenantId !== client.tenant_id) {
    userId = ''
    tenantId = ''
    tenantSwitch = true
  }

  const tooOld = maxAge !== undefined && authTime > 0 && nowInSeconds() - authTime > maxAge
  if (!userId || !tenantId || prompts.has('login') || tooOld) {
    if (prompts.has('none')) {
      // Silent probe: never touch the session, it still belongs to another live client.
      return fail('login_required', 'User is not signed in')
    }
    if (tenantSwitch) {
      // Interactive re-auth: drop the foreign session so the login page cannot silently
      // resume it and bounce right back here.
      deleteCookie(event, 'sso_refresh_token', { path: '/' })
    }
    return loginRedirect(event, clientId, tenantSwitch || (Boolean(userId) && (prompts.has('login') || tooOld)))
  }

  try {
    await assertUserActive(event, userId)
  } catch {
    return fail('access_denied', 'User inactive')
  }

  const code = randomId(32)
  const expiresAt = nowInSeconds() + 300

  await db
    .prepare(
      `INSERT INTO auth_codes
       (id, code, client_id, tenant_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, ip, user_agent, auth_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      code,
      client.id,
      tenantId,
      userId,
      redirectUri,
      scope,
      nonce || null,
      codeChallenge || null,
      codeChallengeMethod,
      expiresAt,
      getRequestIP(event) || '',
      getRequestHeader(event, 'user-agent') || '',
      authTime || null,
    )
    .run()

  const redirect = new URL(redirectUriRaw.trim())
  redirect.searchParams.set('code', code)
  if (state) redirect.searchParams.set('state', state)
  return sendRedirect(event, redirect.toString(), 302)
})
