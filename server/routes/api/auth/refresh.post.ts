import { createError, defineEventHandler, getCookie, readBody, setCookie } from 'h3'
import { getDb } from '../../../utils/env'
import { getSessionByRefreshToken, rotateSession } from '../../../utils/auth'
import { getUserRolesForClient } from '../../../utils/access'
import { ensureClientManagementSchema } from '../../../utils/identity'
import { writeAuditLog } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as { refresh_token?: string }
  const refreshToken = body.refresh_token || getCookie(event, 'sso_refresh_token')
  if (!refreshToken) throw createError({ statusCode: 400, statusMessage: 'refresh_token required' })

  const session = await getSessionByRefreshToken(event, refreshToken)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Invalid refresh token' })

  const db = getDb(event)
  await ensureClientManagementSchema(event)
  const client = await db
    .prepare(`SELECT id, client_id, scope, status FROM clients WHERE id = ?`)
    .bind(session.client_id)
    .first<{ id: string; client_id: string; scope: string; status?: string }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Client not found for session' })
  if ((client.status || 'active') !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Client disabled' })
  }

  const user = await db
    .prepare(`SELECT id, email, locale, tenant_id, global_account_id FROM users WHERE id = ?`)
    .bind(session.user_id)
    .first<{ id: string; email: string; locale?: string; tenant_id: string; global_account_id?: string | null }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const roles = await getUserRolesForClient(event, user.id, user.tenant_id, client.id)
  const tokens = await rotateSession(event, session.id, user, client, client.scope || 'openid profile email', roles)

  setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(tokens.refreshTokenExpiresAt * 1000),
  })

  await writeAuditLog(event, {
    tenantId: user.tenant_id,
    userId: user.id,
    action: 'auth.refresh',
    payload: { client_id: client.client_id, session_id: session.id },
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
