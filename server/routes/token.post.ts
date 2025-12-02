import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { getDb } from '../utils/env'
import { getSessionByRefreshToken, issueTokens, rotateSession } from '../utils/auth'
import { nowInSeconds, base64UrlEncode } from '../utils/crypto'
import { getUserRolesForClient } from '../utils/access'

const hashVerifier = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

export default defineEventHandler(async (event) => {
  const db = getDb(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const grantType = body.grant_type
  const authHeader = getRequestHeader(event, 'authorization')
  const basicAuth = authHeader?.startsWith('Basic ')
    ? atob(authHeader.slice('Basic '.length)).split(':', 2)
    : undefined
  const bodyClientId = typeof body.client_id === 'string' ? body.client_id : undefined
  const bodyClientSecret = typeof body.client_secret === 'string' ? body.client_secret : undefined
  const clientId = basicAuth?.[0] || bodyClientId
  const clientSecret = basicAuth?.[1] || bodyClientSecret

  if (!clientId) throw createError({ statusCode: 400, statusMessage: 'client_id required' })

  const client = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<{
    id: string
    tenant_id: string
    client_secret: string | null
    redirect_uris: string
    scope: string
  }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Unknown client' })

  if (client.client_secret && clientSecret !== client.client_secret) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid client secret' })
  }

  if (grantType === 'authorization_code') {
    const code = typeof body.code === 'string' ? body.code : undefined
    const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined
    const codeVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : undefined
    if (!code || !redirectUri || !codeVerifier) {
      throw createError({ statusCode: 400, statusMessage: 'code, redirect_uri, code_verifier are required' })
    }
    const authCode = await db
      .prepare(
        `SELECT ac.*, u.email, u.locale
         FROM auth_codes ac
         JOIN users u ON u.id = ac.user_id
         WHERE ac.code = ?`,
      )
      .bind(code)
      .first<{
        id: string
        client_id: string
        user_id: string
        tenant_id: string
        redirect_uri: string
        scope: string
        nonce: string | null
        code_challenge: string | null
        code_challenge_method: string | null
        expires_at: number
        consumed_at: number | null
        email: string
        locale?: string
      }>()
    if (!authCode) throw createError({ statusCode: 400, statusMessage: 'Invalid authorization code' })
    if (authCode.consumed_at) throw createError({ statusCode: 400, statusMessage: 'Authorization code used' })
    if (authCode.expires_at && nowInSeconds() > authCode.expires_at) {
      throw createError({ statusCode: 400, statusMessage: 'Authorization code expired' })
    }
    if (authCode.client_id !== client.id) throw createError({ statusCode: 400, statusMessage: 'Client mismatch' })
    if (authCode.redirect_uri !== redirectUri) {
      throw createError({ statusCode: 400, statusMessage: 'redirect_uri mismatch' })
    }
    if (authCode.code_challenge) {
      const expected = await hashVerifier(codeVerifier)
      if (expected !== authCode.code_challenge) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid code_verifier' })
      }
    }

    await db.prepare(`UPDATE auth_codes SET consumed_at = ? WHERE id = ?`).bind(nowInSeconds(), authCode.id).run()
    const roles = await getUserRolesForClient(event, authCode.user_id, authCode.tenant_id, client.id)
    const tokens = await issueTokens(event, {
      id: authCode.user_id,
      tenant_id: authCode.tenant_id,
      email: authCode.email,
      locale: authCode.locale,
    }, { id: client.id, client_id: clientId }, authCode.scope, undefined, roles)
    return {
      token_type: 'Bearer',
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.accessTokenExpiresIn,
      scope: authCode.scope,
    }
  }

  if (grantType === 'refresh_token') {
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined
    if (!refreshToken) throw createError({ statusCode: 400, statusMessage: 'refresh_token required' })
    const session = await getSessionByRefreshToken(event, refreshToken)
    if (!session) throw createError({ statusCode: 401, statusMessage: 'Invalid refresh token' })
    if (session.client_id && session.client_id !== client.id) {
      throw createError({ statusCode: 403, statusMessage: 'Client mismatch' })
    }

    const userRow = await db
      .prepare(`SELECT id, email, locale, tenant_id FROM users WHERE id = ?`)
      .bind(session.user_id)
      .first<{ id: string; email: string; locale?: string; tenant_id: string }>()
    if (!userRow) throw createError({ statusCode: 404, statusMessage: 'User not found' })

    const roles = await getUserRolesForClient(event, userRow.id, userRow.tenant_id, client.id)
    const rotated = await rotateSession(
      event,
      session.id,
      userRow,
      { id: client.id, client_id: clientId },
      client.scope || 'openid profile email',
      roles,
    )
    return {
      token_type: 'Bearer',
      access_token: rotated.accessToken,
      id_token: rotated.idToken,
      refresh_token: rotated.refreshToken,
      expires_in: rotated.accessTokenExpiresIn,
      scope: client.scope,
    }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unsupported grant_type' })
})
