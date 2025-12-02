import { createError, defineEventHandler, readBody, setCookie } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { verifyPassword } from '../../../utils/crypto'
import { issueTokens } from '../../../utils/auth'

type LoginBody = {
  email?: string
  password?: string
  tenant_id?: string
  client_id?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as LoginBody
  const email = body.email?.toLowerCase().trim()
  const password = body.password
  const tenantId = body.tenant_id || 'tenant-demo'
  const clientPublicId = body.client_id

  if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'email and password required' })
  if (!clientPublicId) throw createError({ statusCode: 400, statusMessage: 'client_id required' })

  const db = getDb(event)
  const env = getEnv(event)

  const user = await db
    .prepare(`SELECT id, tenant_id, email, password_hash, locale, status FROM users WHERE tenant_id = ? AND normalized_email = lower(?)`)
    .bind(tenantId, email)
    .first<{ id: string; tenant_id: string; email: string; password_hash: string; locale?: string; status: string }>()

  if (!user || !user.password_hash) throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  if (user.status !== 'active') throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })

  const passwordOk = await verifyPassword(password, user.password_hash, env.PASSWORD_PEPPER || '')
  if (!passwordOk) throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })

  const client = await db
    .prepare(`SELECT id, client_id, tenant_id, scope FROM clients WHERE client_id = ?`)
    .bind(clientPublicId)
    .first<{ id: string; client_id: string; tenant_id: string; scope: string }>()
  if (!client) throw createError({ statusCode: 400, statusMessage: 'Unknown client_id' })
  if (client.tenant_id !== user.tenant_id) throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })

  const tokens = await issueTokens(event, user, client, client.scope || 'openid profile email')

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
    user: { id: user.id, email: user.email, tenant_id: user.tenant_id, locale: user.locale },
  }
})
