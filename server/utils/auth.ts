import { createError, getRequestHeader, getRequestIP, getRequestURL, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { hashToken, nowInSeconds, randomId } from './crypto'
import { signJwt } from './jwt'
import { oncePerDb } from './schema-once'
import { flattenPermissions, RoleWithPermissions } from './access'
import { grantSignupTrialSafely } from './trials'

export type BasicUser = {
  id: string
  tenant_id: string
  email: string
  locale?: string
  global_account_id?: string | null
}

export const getIssuer = (event: H3Event, env = getEnv(event)) => {
  const requestUrl = getRequestURL(event).origin
  return env.JWT_ISSUER || requestUrl
}

export type ClientRef = { id: string; client_id?: string }

export type IssueOptions = {
  roles?: RoleWithPermissions[]
  /** When the user actually authenticated (seconds). Defaults to now, i.e. a fresh sign-in. */
  authTime?: number
  /** OIDC nonce from /authorize, echoed into the id_token. */
  nonce?: string | null
}

/** Old refresh token presented this long after rotation counts as a concurrent refresh, not a replay. */
const REFRESH_REUSE_GRACE_SECONDS = 30
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

const isDuplicateColumn = (error: unknown) => /duplicate column/i.test(String((error as Error)?.message || error))

/** Columns added after the first deploy; schema.sql has them for fresh databases. */
const sessionSchema = oncePerDb(async (db) => {
  const additions: Array<[string, string, string]> = [
    ['sessions', 'auth_time', 'auth_time INTEGER'],
    ['sessions', 'scope', 'scope TEXT'],
    ['sessions', 'previous_refresh_token_hash', 'previous_refresh_token_hash TEXT'],
    ['sessions', 'rotated_at', 'rotated_at INTEGER'],
    ['auth_codes', 'auth_time', 'auth_time INTEGER'],
  ]
  for (const table of ['sessions', 'auth_codes']) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
    const existing = new Set((info.results || []).map((row) => row.name))
    for (const [t, column, definition] of additions) {
      if (t !== table || existing.has(column)) continue
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run()
      } catch (error) {
        if (!isDuplicateColumn(error)) throw error
      }
    }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_prev_token ON sessions (previous_refresh_token_hash)`).run()
})

export const ensureSessionSchema = (event: H3Event) => sessionSchema(getDb(event))

const signTokenPair = async (
  event: H3Event,
  user: BasicUser,
  client: ClientRef,
  scope: string,
  sessionId: string,
  options: IssueOptions & { authTime: number },
) => {
  const env = getEnv(event)
  const accessTtl = Number(env.ACCESS_TOKEN_TTL_SECONDS || 600)
  const roleIds = options.roles?.map((r) => r.name) || []
  const permissions = options.roles ? flattenPermissions(options.roles) : []
  const signOptions = {
    expiresInSeconds: accessTtl,
    issuer: getIssuer(event, env),
    audience: client.client_id || client.id,
  }

  const accessToken = await signJwt(
    event,
    {
      sub: user.id,
      tid: user.tenant_id,
      gaid: user.global_account_id || undefined,
      sid: sessionId,
      scope,
      email: user.email,
      token_use: 'access',
      roles: roleIds,
      perms: permissions,
      auth_time: options.authTime,
    },
    signOptions,
  )

  const idToken = await signJwt(
    event,
    {
      sub: user.id,
      tid: user.tenant_id,
      gaid: user.global_account_id || undefined,
      sid: sessionId,
      email: user.email,
      locale: user.locale,
      scope,
      token_use: 'id',
      roles: roleIds,
      auth_time: options.authTime,
      nonce: options.nonce || undefined,
    },
    signOptions,
  )

  return { accessToken, idToken, accessTokenExpiresIn: accessTtl }
}

export const issueTokens = async (
  event: H3Event,
  user: BasicUser,
  client: ClientRef,
  scope: string,
  options: IssueOptions = {},
) => {
  await ensureSessionSchema(event)
  const env = getEnv(event)
  const refreshTtl = Number(env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 14)
  const refreshToken = randomId(48)
  const refreshTokenHash = await hashToken(refreshToken)
  const sessionId = crypto.randomUUID()
  const now = nowInSeconds()
  const authTime = options.authTime || now
  const expiresAt = now + refreshTtl
  await getDb(event)
    .prepare(
      `INSERT INTO sessions (id, tenant_id, user_id, client_id, refresh_token_hash, user_agent, ip, expires_at, auth_time, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      user.tenant_id,
      user.id,
      client.id,
      refreshTokenHash,
      getRequestHeader(event, 'user-agent') || '',
      getRequestIP(event) || '',
      expiresAt,
      authTime,
      scope,
    )
    .run()

  // Every sign-in into a tenant ends here, so this is where a tenant's first-use trial is granted.
  await grantSignupTrialSafely(event, user)
  const signed = await signTokenPair(event, user, client, scope, sessionId, { ...options, authTime })
  return {
    sessionId,
    ...signed,
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
    refreshTokenHash,
  }
}

export type RefreshSession = {
  id: string
  tenant_id: string
  user_id: string
  client_id: string
  email: string
  locale?: string
  expires_at: number
  revoked_at?: number | null
  created_at: number
  auth_time?: number | null
  scope?: string | null
  refresh_token_hash: string
}

/**
 * Rotates the refresh token with a compare-and-swap on the presented hash, so two concurrent
 * refreshes cannot both mint a new token. The session keeps its auth_time and granted scope and
 * never outlives SESSION_MAX_AGE_SECONDS from when it was created.
 */
export const rotateSession = async (
  event: H3Event,
  session: RefreshSession,
  user: BasicUser,
  client: ClientRef,
  roles?: RoleWithPermissions[],
) => {
  const env = getEnv(event)
  const refreshTtl = Number(env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 14)
  const maxAge = Number(env.SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS)
  const now = nowInSeconds()
  const refreshToken = randomId(48)
  const refreshTokenHash = await hashToken(refreshToken)
  const expiresAt = Math.min(now + refreshTtl, Number(session.created_at || now) + maxAge)
  if (expiresAt <= now) throw createError({ statusCode: 401, statusMessage: 'Session expired' })

  const result = await getDb(event)
    .prepare(
      `UPDATE sessions
       SET refresh_token_hash = ?, previous_refresh_token_hash = refresh_token_hash, rotated_at = ?, expires_at = ?
       WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(refreshTokenHash, now, expiresAt, session.id, session.refresh_token_hash)
    .run()
  if (!result.meta?.changes) throw createError({ statusCode: 401, statusMessage: 'Invalid refresh token' })
  // Long-lived sessions that predate a tenant's trial get it on their next refresh.
  await grantSignupTrialSafely(event, user)

  const scope = session.scope || 'openid profile email'
  const authTime = Number(session.auth_time || session.created_at || now)
  const signed = await signTokenPair(event, user, client, scope, session.id, { roles, authTime })
  return { ...signed, refreshToken, refreshTokenExpiresAt: expiresAt, scope }
}

export const revokeSession = async (event: H3Event, sessionId: string) => {
  const db = getDb(event)
  await db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).bind(nowInSeconds(), sessionId).run()
}

/**
 * Looks up a live session by refresh token. A token that was already rotated away is a replay
 * (a stolen copy, or the legitimate client after the thief refreshed): the whole session is
 * revoked, unless it lands within a few seconds of the rotation (two tabs refreshing at once).
 */
export const getSessionByRefreshToken = async (event: H3Event, refreshToken: string) => {
  await ensureSessionSchema(event)
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
    .first<RefreshSession>()
  if (!row) {
    const replayed = await db
      .prepare(`SELECT id, rotated_at, revoked_at FROM sessions WHERE previous_refresh_token_hash = ?`)
      .bind(hash)
      .first<{ id: string; rotated_at?: number | null; revoked_at?: number | null }>()
    if (replayed && !replayed.revoked_at && nowInSeconds() - Number(replayed.rotated_at || 0) > REFRESH_REUSE_GRACE_SECONDS) {
      await revokeSession(event, replayed.id)
      console.warn('refresh token replay detected; session revoked', { session_id: replayed.id })
    }
    return null
  }
  if (row.revoked_at) return null
  if (row.expires_at && nowInSeconds() > row.expires_at) return null
  return row
}

/** Disabled users or accounts must not keep minting tokens from an old refresh token. */
export const assertUserActive = async (event: H3Event, userId: string) => {
  const row = await getDb(event)
    .prepare(
      `SELECT u.status AS user_status, g.status AS account_status
       FROM users u LEFT JOIN global_accounts g ON g.id = u.global_account_id
       WHERE u.id = ?`,
    )
    .bind(userId)
    .first<{ user_status?: string | null; account_status?: string | null }>()
  if (!row) throw createError({ statusCode: 401, statusMessage: 'User not found' })
  if ((row.user_status || 'active') !== 'active' || (row.account_status || 'active') !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'User inactive' })
  }
}
