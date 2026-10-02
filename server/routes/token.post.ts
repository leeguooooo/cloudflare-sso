import { defineEventHandler, getRequestHeader, H3Event, readBody, setResponseHeader } from 'h3'
import { getDb } from '../utils/env'
import { assertUserActive, ensureSessionSchema, getSessionByRefreshToken, issueTokens, rotateSession } from '../utils/auth'
import { nowInSeconds, base64UrlEncode } from '../utils/crypto'
import { getUserRolesForClient } from '../utils/access'
import { ensureClientManagementSchema } from '../utils/identity'
import { writeAuditLog } from '../utils/audit'
import { normalizeRedirectUriForMatch } from '../utils/redirect-uri'
import { OAuthError, readClientCredentials, sendOAuthError } from '../utils/oauth-error'
import { issueClientCredentialsToken, verifyClientSecret } from '../utils/client-auth'

const hashVerifier = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

type ClientRow = {
  id: string
  tenant_id: string
  client_secret: string | null
  redirect_uris: string
  grant_types?: string | null
  scope: string
  status?: string
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const exchangeAuthorizationCode = async (event: H3Event, body: Record<string, unknown>, client: ClientRow, clientId: string) => {
  const db = getDb(event)
  const code = str(body.code)
  const redirectUriRaw = str(body.redirect_uri)
  const codeVerifier = str(body.code_verifier)
  if (!code || !redirectUriRaw) throw new OAuthError('invalid_request', 'code and redirect_uri are required')
  const redirectUri = normalizeRedirectUriForMatch(redirectUriRaw)

  const authCode = await db
    .prepare(
      `SELECT ac.*, u.email, u.locale, u.global_account_id
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
      expires_at: number
      consumed_at: number | null
      auth_time?: number | null
      email: string
      locale?: string
      global_account_id?: string | null
    }>()
  if (!authCode) throw new OAuthError('invalid_grant', 'Invalid authorization code')
  if (authCode.expires_at && nowInSeconds() > authCode.expires_at) throw new OAuthError('invalid_grant', 'Authorization code expired')
  if (authCode.client_id !== client.id) throw new OAuthError('invalid_grant', 'Authorization code was issued to another client')
  if (normalizeRedirectUriForMatch(authCode.redirect_uri) !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch')
  // Every client is public unless it has a secret, so PKCE is what binds the code to its requester.
  if (!authCode.code_challenge && !client.client_secret) throw new OAuthError('invalid_grant', 'PKCE is required for this client')
  if (authCode.code_challenge) {
    if (!codeVerifier) throw new OAuthError('invalid_request', 'code_verifier required')
    if ((await hashVerifier(codeVerifier)) !== authCode.code_challenge) throw new OAuthError('invalid_grant', 'Invalid code_verifier')
  }

  // Compare-and-swap: of two concurrent redemptions exactly one wins.
  const consumed = await db
    .prepare(`UPDATE auth_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .bind(nowInSeconds(), authCode.id)
    .run()
  if (!consumed.meta?.changes) throw new OAuthError('invalid_grant', 'Authorization code already used')

  await assertUserActive(event, authCode.user_id)
  const roles = await getUserRolesForClient(event, authCode.user_id, authCode.tenant_id, client.id)
  const tokens = await issueTokens(
    event,
    {
      id: authCode.user_id,
      tenant_id: authCode.tenant_id,
      email: authCode.email,
      locale: authCode.locale,
      global_account_id: authCode.global_account_id,
    },
    { id: client.id, client_id: clientId },
    authCode.scope,
    { roles, nonce: authCode.nonce, authTime: Number(authCode.auth_time || 0) || undefined },
  )

  await writeAuditLog(event, {
    tenantId: authCode.tenant_id,
    userId: authCode.user_id,
    action: 'auth.token.authorization_code',
    payload: { client_id: clientId, scope: authCode.scope },
  })

  return {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.accessTokenExpiresIn,
    scope: authCode.scope,
  }
}

const exchangeRefreshToken = async (event: H3Event, body: Record<string, unknown>, client: ClientRow, clientId: string) => {
  const db = getDb(event)
  const refreshToken = str(body.refresh_token)
  if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token required')
  const session = await getSessionByRefreshToken(event, refreshToken)
  if (!session) throw new OAuthError('invalid_grant', 'Invalid refresh token')
  if (session.client_id && session.client_id !== client.id) throw new OAuthError('invalid_grant', 'Refresh token was issued to another client')

  await assertUserActive(event, session.user_id)
  const userRow = await db
    .prepare(`SELECT id, email, locale, tenant_id, global_account_id FROM users WHERE id = ?`)
    .bind(session.user_id)
    .first<{ id: string; email: string; locale?: string; tenant_id: string; global_account_id?: string | null }>()
  if (!userRow) throw new OAuthError('invalid_grant', 'User not found')

  const roles = await getUserRolesForClient(event, userRow.id, userRow.tenant_id, client.id)
  let rotated
  try {
    rotated = await rotateSession(event, session, userRow, { id: client.id, client_id: clientId }, roles)
  } catch {
    throw new OAuthError('invalid_grant', 'Invalid refresh token')
  }

  await writeAuditLog(event, {
    tenantId: userRow.tenant_id,
    userId: userRow.id,
    action: 'auth.token.refresh_token',
    payload: { client_id: clientId, session_id: session.id },
  })

  return {
    token_type: 'Bearer',
    access_token: rotated.accessToken,
    id_token: rotated.idToken,
    refresh_token: rotated.refreshToken,
    expires_in: rotated.accessTokenExpiresIn,
    scope: rotated.scope,
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    const db = getDb(event)
    await ensureClientManagementSchema(event)
    await ensureSessionSchema(event)
    const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
    const grantType = body.grant_type
    const { clientId, clientSecret } = readClientCredentials(getRequestHeader(event, 'authorization'), body)
    if (!clientId) throw new OAuthError('invalid_request', 'client_id required')

    const client = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<ClientRow>()
    if (!client) throw new OAuthError('invalid_client', 'Unknown client')
    if ((client.status || 'active') !== 'active') throw new OAuthError('invalid_client', 'Client disabled')
    if (client.client_secret && !(await verifyClientSecret(clientSecret, client.client_secret))) {
      throw new OAuthError('invalid_client', 'Invalid client secret')
    }

    if (grantType === 'authorization_code') return await exchangeAuthorizationCode(event, body, client, clientId)
    if (grantType === 'refresh_token') return await exchangeRefreshToken(event, body, client, clientId)
    if (grantType === 'client_credentials') return await issueClientCredentialsToken(event, client, clientId, str(body.scope))
    throw new OAuthError('unsupported_grant_type', 'Unsupported grant_type')
  } catch (error) {
    if (error instanceof OAuthError) return sendOAuthError(event, error)
    throw error
  }
})
