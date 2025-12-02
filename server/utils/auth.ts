import { getRequestHeader, getRequestIP, getRequestURL, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { hashToken, nowInSeconds, randomId } from './crypto'
import { signJwt } from './jwt'
import { flattenPermissions, getUserRolesForClient, RoleWithPermissions } from './access'

export type BasicUser = {
  id: string
  tenant_id: string
  email: string
  locale?: string
}

export const getIssuer = (event: H3Event, env = getEnv(event)) => {
  const requestUrl = getRequestURL(event).origin
  return env.JWT_ISSUER || requestUrl
}

export type ClientRef = { id: string; client_id?: string }

export const issueTokens = async (
  event: H3Event,
  user: BasicUser,
  client: ClientRef,
  scope: string,
  sessionId?: string,
  roles?: RoleWithPermissions[],
) => {
  const env = getEnv(event)
  const accessTtl = Number(env.ACCESS_TOKEN_TTL_SECONDS || 600)
  const refreshTtl = Number(env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 14)
  const refreshToken = randomId(48)
  const refreshTokenHash = await hashToken(refreshToken)
  const session = sessionId || crypto.randomUUID()
  const db = getDb(event)
  const expiresAt = nowInSeconds() + refreshTtl
  await db
    .prepare(
      `INSERT INTO sessions (id, tenant_id, user_id, client_id, refresh_token_hash, user_agent, ip, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session,
      user.tenant_id,
      user.id,
      client.id,
      refreshTokenHash,
      getRequestHeader(event, 'user-agent') || '',
      getRequestIP(event) || '',
      expiresAt,
    )
    .run()

  const roleIds = roles?.map((r) => r.name) || []
  const permissions = roles ? flattenPermissions(roles) : []

  const accessToken = await signJwt(
    event,
    {
      sub: user.id,
      tid: user.tenant_id,
      sid: session,
      scope,
      email: user.email,
      token_use: 'access',
      roles: roleIds,
      perms: permissions,
    },
    {
      expiresInSeconds: accessTtl,
      issuer: getIssuer(event, env),
      audience: client.client_id || client.id,
    },
  )

  const idToken = await signJwt(
    event,
    {
      sub: user.id,
      tid: user.tenant_id,
      sid: session,
      email: user.email,
      locale: user.locale,
      scope,
      token_use: 'id',
      roles: roleIds,
    },
    {
      expiresInSeconds: accessTtl,
      issuer: getIssuer(event, env),
      audience: client.client_id || client.id,
    },
  )

  return {
    sessionId: session,
    accessToken,
    idToken,
    refreshToken,
    accessTokenExpiresIn: accessTtl,
    refreshTokenExpiresAt: expiresAt,
    refreshTokenHash,
  }
}

export const rotateSession = async (
  event: H3Event,
  sessionId: string,
  user: BasicUser,
  client: ClientRef,
  scope: string,
  roles?: RoleWithPermissions[],
) => {
  const env = getEnv(event)
  const refreshTtl = Number(env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 14)
  const refreshToken = randomId(48)
  const refreshTokenHash = await hashToken(refreshToken)
  const expiresAt = nowInSeconds() + refreshTtl
  const db = getDb(event)
  await db
    .prepare(`UPDATE sessions SET refresh_token_hash = ?, expires_at = ?, revoked_at = NULL WHERE id = ?`)
    .bind(refreshTokenHash, expiresAt, sessionId)
    .run()

  const accessTtl = Number(env.ACCESS_TOKEN_TTL_SECONDS || 600)
  const roleIds = roles?.map((r) => r.name) || []
  const permissions = roles ? flattenPermissions(roles) : []

  const accessToken = await signJwt(
    event,
    { sub: user.id, tid: user.tenant_id, sid: sessionId, scope, email: user.email, token_use: 'access', roles: roleIds, perms: permissions },
    { expiresInSeconds: accessTtl, issuer: getIssuer(event, env), audience: client.client_id || client.id },
  )
  const idToken = await signJwt(
    event,
    { sub: user.id, tid: user.tenant_id, sid: sessionId, email: user.email, locale: user.locale, scope, token_use: 'id', roles: roleIds },
    { expiresInSeconds: accessTtl, issuer: getIssuer(event, env), audience: client.client_id || client.id },
  )
  return { accessToken, idToken, refreshToken, refreshTokenExpiresAt: expiresAt, accessTokenExpiresIn: accessTtl }
}

export const revokeSession = async (event: H3Event, sessionId: string) => {
  const db = getDb(event)
  await db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).bind(nowInSeconds(), sessionId).run()
}

export const getSessionByRefreshToken = async (event: H3Event, refreshToken: string) => {
  const db = getDb(event)
  const hash = await hashToken(refreshToken)
  const row = await db
    .prepare(
      `SELECT s.*, u.email, u.locale
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ?`,
    )
    .bind(hash)
    .first<{ id: string; tenant_id: string; user_id: string; client_id: string; email: string; locale?: string; expires_at: number; revoked_at?: number }>()
  if (!row) return null
  if (row.revoked_at) return null
  if (row.expires_at && nowInSeconds() > row.expires_at) return null
  return row
}
