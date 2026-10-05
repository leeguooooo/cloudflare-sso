import { getCookie, getRequestHeader, getRequestHost, H3Event } from 'h3'
import { getIssuer, getSessionByRefreshToken } from './auth'
import { getDb } from './env'

/**
 * The browser's first-party session (sso_refresh_token cookie), trusted exactly like /authorize
 * trusts it. Bearer tokens are not accepted: a leaked token must not be able to act for the browser's user.
 */
export const getBrowserSessionAccount = async (event: H3Event) => {
  const refreshToken = getCookie(event, 'sso_refresh_token')
  if (!refreshToken) return null
  const session = await getSessionByRefreshToken(event, refreshToken)
  if (!session) return null
  const user = await getDb(event)
    .prepare(
      `SELECT u.id, u.global_account_id, COALESCE(g.email, u.email) AS email
       FROM users u LEFT JOIN global_accounts g ON g.id = u.global_account_id
       WHERE u.id = ?`,
    )
    .bind(session.user_id)
    .first<{ id: string; global_account_id?: string | null; email: string }>()
  if (!user) return null
  return {
    userId: user.id,
    globalAccountId: user.global_account_id || null,
    email: user.email,
    authTime: Number(session.auth_time || session.created_at || 0),
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Cookie-authenticated POSTs from our own pages. The cookie is SameSite=Lax; refusing a foreign
 * Origin also stops form posts from other sites. No Origin header (non-browser) passes.
 */
export const isSameOriginRequest = (event: H3Event) => {
  const origin = getRequestHeader(event, 'origin')
  if (!origin) return true
  return [getRequestHost(event), hostOf(getIssuer(event))].includes(hostOf(origin))
}
