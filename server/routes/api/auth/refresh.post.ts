import { createError, defineEventHandler, getCookie, readBody, setCookie } from 'h3'
import { getDb } from '../../../utils/env'
import { getSessionByRefreshToken, rotateSession } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as { refresh_token?: string }
  const refreshToken = body.refresh_token || getCookie(event, 'sso_refresh_token')
  if (!refreshToken) throw createError({ statusCode: 400, statusMessage: 'refresh_token required' })

  const session = await getSessionByRefreshToken(event, refreshToken)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Invalid refresh token' })

  const db = getDb(event)
  const client = await db
    .prepare(`SELECT id, client_id, scope FROM clients WHERE id = ?`)
    .bind(session.client_id)
    .first<{ id: string; client_id: string; scope: string }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Client not found for session' })

  const user = await db
    .prepare(`SELECT id, email, locale, tenant_id FROM users WHERE id = ?`)
    .bind(session.user_id)
    .first<{ id: string; email: string; locale?: string; tenant_id: string }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const tokens = await rotateSession(event, session.id, user, client, client.scope || 'openid profile email')

  setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(tokens.refreshTokenExpiresAt * 1000),
  })

  return {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.accessTokenExpiresIn,
    scope: client.scope,
  }
})
