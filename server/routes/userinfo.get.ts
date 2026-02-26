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
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.locale,
        u.tenant_id,
        gei.profile_json
      FROM users u
      LEFT JOIN global_external_identities gei
        ON gei.global_account_id = u.global_account_id
       AND gei.updated_at = (
         SELECT MAX(gei2.updated_at)
         FROM global_external_identities gei2
         WHERE gei2.global_account_id = u.global_account_id
       )
      WHERE u.id = ?
    `)
    .bind(sub)
    .first<{ id: string; email: string; locale?: string; tenant_id: string; profile_json?: string | null }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const clientId = payload.aud as string | undefined
  const roles = clientId ? await getUserRolesForClient(event, user.id, user.tenant_id, clientId) : []
  const perms = flattenPermissions(roles)
  const externalProfile = (() => {
    if (!user.profile_json) return {}
    try {
      const parsed = JSON.parse(user.profile_json)
      return typeof parsed === 'object' && parsed ? parsed : {}
    } catch {
      return {}
    }
  })() as Record<string, unknown>

  const profileName =
    typeof externalProfile.name === 'string' && externalProfile.name.trim()
      ? externalProfile.name.trim()
      : undefined
  const profileAvatar = typeof externalProfile.avatar_url === 'string' && externalProfile.avatar_url.trim()
    ? externalProfile.avatar_url.trim()
    : typeof externalProfile.picture === 'string' && externalProfile.picture.trim()
      ? externalProfile.picture.trim()
      : undefined

  return {
    sub: user.id,
    email: user.email,
    email_verified: true,
    locale: user.locale,
    tid: user.tenant_id,
    gaid: typeof payload.gaid === 'string' ? payload.gaid : undefined,
    name: profileName,
    avatar_url: profileAvatar,
    roles: roles.map((r) => r.name),
    perms,
  }
})
