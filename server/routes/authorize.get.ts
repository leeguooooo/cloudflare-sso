import { createError, defineEventHandler, getCookie, getQuery, getRequestHeader, getRequestIP, getRequestURL, sendRedirect } from 'h3'
import { getSessionByRefreshToken } from '../utils/auth'
import { getDb } from '../utils/env'
import { ensureClientManagementSchema } from '../utils/identity'
import { verifyJwt } from '../utils/jwt'
import { nowInSeconds, randomId } from '../utils/crypto'
import { normalizeRedirectUriForMatch } from '../utils/redirect-uri'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const responseType = query.response_type
  if (responseType !== 'code') {
    throw createError({ statusCode: 400, statusMessage: 'response_type must be code' })
  }

  const clientId = String(query.client_id || '')
  const redirectUriRaw = String(query.redirect_uri || '')
  const redirectUri = normalizeRedirectUriForMatch(redirectUriRaw)
  const scope = String(query.scope || 'openid profile email')
  const state = query.state ? String(query.state) : undefined
  const nonce = query.nonce ? String(query.nonce) : undefined
  const prompt = query.prompt ? String(query.prompt) : undefined
  const codeChallenge = query.code_challenge ? String(query.code_challenge) : undefined
  const codeChallengeMethod = String(query.code_challenge_method || 'S256')
  if (!clientId || !redirectUri) {
    throw createError({ statusCode: 400, statusMessage: 'client_id and redirect_uri are required' })
  }
  if (codeChallengeMethod !== 'S256') {
    throw createError({ statusCode: 400, statusMessage: 'Only PKCE S256 is supported' })
  }

  const db = getDb(event)
  await ensureClientManagementSchema(event)
  const client = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<{
    id: string
    tenant_id: string
    redirect_uris: string
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

  let userId = ''
  let tenantId = ''
  const authHeader = getRequestHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const accessToken = authHeader.slice('Bearer '.length)
    const payload = await verifyJwt(event, accessToken)
    userId = String(payload.sub || '')
    tenantId = String(payload.tid || '')
  } else {
    const refreshToken = getCookie(event, 'sso_refresh_token')
    if (refreshToken) {
      const session = await getSessionByRefreshToken(event, refreshToken)
      if (session) {
        userId = session.user_id
        tenantId = session.tenant_id
      }
    }
  }

  if (!userId || !tenantId) {
    if (prompt === 'none') {
      throw createError({ statusCode: 401, statusMessage: 'login_required' })
    }
    const requestUrl = getRequestURL(event)
    const continuePath = `${requestUrl.pathname}${requestUrl.search}`
    const loginPath = `/login?continue=${encodeURIComponent(continuePath)}&client_id=${encodeURIComponent(clientId)}`
    return sendRedirect(event, loginPath, 302)
  }

  if (tenantId !== client.tenant_id) {
    throw createError({ statusCode: 403, statusMessage: 'Client and user tenant mismatch' })
  }

  const user = await db
    .prepare(`SELECT status FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ status: string }>()
  if (!user) throw createError({ statusCode: 401, statusMessage: 'User not found' })
  if (user.status !== 'active') throw createError({ statusCode: 403, statusMessage: 'User inactive' })

  const code = randomId(32)
  const expiresAt = nowInSeconds() + 300

  await db
    .prepare(
      `INSERT INTO auth_codes
       (id, code, client_id, tenant_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run()

  const redirect = new URL(redirectUriRaw.trim())
  redirect.searchParams.set('code', code)
  if (state) redirect.searchParams.set('state', state)
  return sendRedirect(event, redirect.toString(), 302)
})
