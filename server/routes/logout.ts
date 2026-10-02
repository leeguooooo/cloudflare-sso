import { defineEventHandler, deleteCookie, getCookie, getQuery, readBody, sendRedirect } from 'h3'
import { getDb } from '../utils/env'
import { getSessionByRefreshToken, revokeSession } from '../utils/auth'
import { verifyJwt } from '../utils/jwt'
import { writeAuditLog } from '../utils/audit'

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** A post-logout target must share an origin with one of the client's registered redirect URIs. */
const isAllowedPostLogoutRedirect = (target: string, redirectUrisJson: string) => {
  let origin: string
  try {
    const url = new URL(target)
    if (url.username || url.password) return false
    origin = url.origin
  } catch {
    return false
  }
  if (origin === 'null') return false
  let registered: unknown
  try {
    registered = JSON.parse(redirectUrisJson || '[]')
  } catch {
    return false
  }
  return Array.isArray(registered) && registered.some((uri) => {
    try {
      return typeof uri === 'string' && new URL(uri).origin === origin
    } catch {
      return false
    }
  })
}

/**
 * OpenID Connect RP-Initiated Logout 1.0 (GET or POST /logout).
 * Signs the browser out of the account host and, with an id_token_hint, revokes the relying
 * party's own session too. Then redirects to post_logout_redirect_uri (when it is allowed for
 * the client) or to the sign-in page.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'POST') {
    return sendRedirect(event, '/login', 303)
  }
  const params = {
    ...(getQuery(event) as Record<string, unknown>),
    ...(event.method === 'POST' ? (((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>) : {}),
  }
  const idTokenHint = str(params.id_token_hint)
  const postLogoutRedirect = str(params.post_logout_redirect_uri)
  const state = str(params.state)
  let clientId = str(params.client_id)
  const db = getDb(event)

  let hintSessionId: string | undefined
  let hintSub: string | undefined
  if (idTokenHint) {
    try {
      const payload = await verifyJwt(event, idTokenHint, { ignoreExpiry: true })
      if (payload.token_use === 'id') {
        hintSessionId = typeof payload.sid === 'string' ? payload.sid : undefined
        hintSub = typeof payload.sub === 'string' ? payload.sub : undefined
        const aud = typeof payload.aud === 'string' ? payload.aud : undefined
        if (clientId && aud && clientId !== aud) clientId = undefined
        else clientId = clientId || aud
      }
    } catch {
      // An invalid hint just means we cannot identify the RP session; still sign out here.
    }
  }

  const revoked: string[] = []
  if (hintSessionId && hintSub) {
    const row = await db
      .prepare(`SELECT id, tenant_id, user_id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
      .bind(hintSessionId, hintSub)
      .first<{ id: string; tenant_id: string; user_id: string }>()
    if (row) {
      await revokeSession(event, row.id)
      revoked.push(row.id)
      await writeAuditLog(event, { tenantId: row.tenant_id, userId: row.user_id, action: 'auth.logout.rp', payload: { session_id: row.id, client_id: clientId || null } })
    }
  }

  const refreshToken = getCookie(event, 'sso_refresh_token')
  if (refreshToken) {
    const session = await getSessionByRefreshToken(event, refreshToken)
    if (session && !revoked.includes(session.id)) {
      await revokeSession(event, session.id)
      await writeAuditLog(event, { tenantId: session.tenant_id, userId: session.user_id, action: 'auth.logout', payload: { session_id: session.id } })
    }
  }
  deleteCookie(event, 'sso_refresh_token', { path: '/' })

  if (postLogoutRedirect && clientId) {
    const client = await db
      .prepare(`SELECT redirect_uris FROM clients WHERE client_id = ?`)
      .bind(clientId)
      .first<{ redirect_uris: string }>()
    if (client && isAllowedPostLogoutRedirect(postLogoutRedirect, client.redirect_uris)) {
      const target = new URL(postLogoutRedirect)
      if (state) target.searchParams.set('state', state)
      return sendRedirect(event, target.toString(), 302)
    }
  }
  const login = clientId ? `/login?signed_out=1&client_id=${encodeURIComponent(clientId)}` : '/login?signed_out=1'
  return sendRedirect(event, login, 302)
})
