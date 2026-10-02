import { createError, defineEventHandler } from 'h3'
import { getDb } from '../utils/env'
import { getUserRolesForClient, flattenPermissions } from '../utils/access'
import { requireAccessPrincipal } from '../utils/guard'
import { accountEmailVerified } from '../utils/oauth-complete'

export default defineEventHandler(async (event) => {
  // Also rejects tokens whose session was signed out or revoked, so connected apps that
  // validate through /userinfo see a sign-out immediately.
  const principal = await requireAccessPrincipal(event)
  const payload = principal.payload
  const sub = principal.sub
  const db = getDb(event)
  const user = await db
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.locale,
        u.tenant_id,
        u.status,
        u.global_account_id,
        ga.status AS account_status,
        ga.display_name,
        ga.avatar_url,
        gei.profile_json
      FROM users u
      LEFT JOIN global_accounts ga ON ga.id = u.global_account_id
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
    .first<{
      id: string
      email: string
      locale?: string
      tenant_id: string
      status?: string | null
      global_account_id?: string | null
      account_status?: string | null
      display_name?: string | null
      avatar_url?: string | null
      profile_json?: string | null
    }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  if ((user.status || 'active') !== 'active' || (user.account_status || 'active') !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'User inactive' })
  }

  // aud is the public client_id; role assignments are keyed by the internal clients.id.
  const clientId = principal.aud
  const client = clientId
    ? await db.prepare(`SELECT id FROM clients WHERE client_id = ?`).bind(clientId).first<{ id: string }>()
    : null
  const roles = client ? await getUserRolesForClient(event, user.id, user.tenant_id, client.id) : []
  const emailVerified = user.global_account_id ? await accountEmailVerified(event, user.global_account_id) : false
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
    typeof user.display_name === 'string' && user.display_name.trim()
      ? user.display_name.trim()
      : typeof externalProfile.name === 'string' && externalProfile.name.trim()
      ? externalProfile.name.trim()
      : undefined
  const profileAvatar =
    typeof user.avatar_url === 'string' && user.avatar_url.trim()
      ? user.avatar_url.trim()
      : typeof externalProfile.avatar_url === 'string' && externalProfile.avatar_url.trim()
    ? externalProfile.avatar_url.trim()
    : typeof externalProfile.picture === 'string' && externalProfile.picture.trim()
      ? externalProfile.picture.trim()
      : undefined

  return {
    sub: user.id,
    email: user.email,
    email_verified: emailVerified,
    locale: user.locale,
    tid: user.tenant_id,
    gaid: typeof payload.gaid === 'string' ? payload.gaid : undefined,
    client_id: clientId,
    name: profileName,
    picture: profileAvatar,
    /** Deprecated alias of `picture`, kept for existing clients. */
    avatar_url: profileAvatar,
    roles: roles.map((r) => r.name),
    perms,
  }
})
