import { createError, defineEventHandler, getQuery, getRequestHeader, getRequestIP, sendRedirect } from 'h3'
import { getDb } from '../utils/env'
import { verifyJwt } from '../utils/jwt'
import { nowInSeconds, randomId } from '../utils/crypto'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const responseType = query.response_type
  if (responseType !== 'code') {
    throw createError({ statusCode: 400, statusMessage: 'response_type must be code' })
  }

  const clientId = String(query.client_id || '')
  const redirectUri = String(query.redirect_uri || '')
  const scope = String(query.scope || 'openid profile email')
  const state = query.state ? String(query.state) : undefined
  const nonce = query.nonce ? String(query.nonce) : undefined
  const codeChallenge = query.code_challenge ? String(query.code_challenge) : undefined
  const codeChallengeMethod = String(query.code_challenge_method || 'S256')
  if (!clientId || !redirectUri) {
    throw createError({ statusCode: 400, statusMessage: 'client_id and redirect_uri are required' })
  }
  if (codeChallengeMethod !== 'S256') {
    throw createError({ statusCode: 400, statusMessage: 'Only PKCE S256 is supported' })
  }

  const db = getDb(event)
  const client = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<{
    id: string
    tenant_id: string
    redirect_uris: string
  }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Unknown client' })

  const allowedRedirects = JSON.parse(client.redirect_uris || '[]') as string[]
  if (!allowedRedirects.includes(redirectUri)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid redirect_uri' })
  }

  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Login required before authorize' })
  }
  const accessToken = authHeader.slice('Bearer '.length)
  const payload = await verifyJwt(event, accessToken)
  const userId = payload.sub as string
  const tenantId = payload.tid as string

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

  const redirect = new URL(redirectUri)
  redirect.searchParams.set('code', code)
  if (state) redirect.searchParams.set('state', state)
  return sendRedirect(event, redirect.toString(), 302)
})
