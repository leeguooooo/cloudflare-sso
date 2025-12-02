import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { getDb } from '../utils/env'
import { verifyJwt } from '../utils/jwt'
import { getUserRolesForClient, flattenPermissions } from '../utils/access'

export default defineEventHandler(async (event) => {
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing access token' })
  }
  const token = authHeader.slice('Bearer '.length)
  const payload = await verifyJwt(event, token)
  if (payload.token_use && payload.token_use !== 'access') {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token use' })
  }
  const sub = payload.sub as string
  const db = getDb(event)
  const user = await db
    .prepare(`SELECT id, email, locale, tenant_id FROM users WHERE id = ?`)
    .bind(sub)
    .first<{ id: string; email: string; locale?: string; tenant_id: string }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const clientId = payload.aud as string | undefined
  const roles = clientId ? await getUserRolesForClient(event, user.id, user.tenant_id, clientId) : []
  const perms = flattenPermissions(roles)
  return {
    sub: user.id,
    email: user.email,
    email_verified: true,
    locale: user.locale,
    tid: user.tenant_id,
    roles: roles.map((r) => r.name),
    perms,
  }
})
