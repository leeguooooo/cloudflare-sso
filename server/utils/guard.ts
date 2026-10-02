import { createError, getRequestHeader, H3Event } from 'h3'
import { verifyJwt } from './jwt'
import { getDb, getEnv } from './env'
import { resolveDefaultClientId } from './default-client'

export type AccessPrincipal = {
  sub: string
  tid: string
  aud?: string
  roles: string[]
  perms: string[]
  /** True for client_credentials tokens: `sub` is `client:<client_id>`, there is no user. */
  clientOnly: boolean
  scopes: string[]
  payload: Record<string, unknown>
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

const readBearerPayload = async (event: H3Event) => {
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing access token' })
  }
  const payload = (await verifyJwt(event, authHeader.slice('Bearer '.length))) as Record<string, unknown>
  if (payload.token_use !== 'access') {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token use' })
  }
  return payload
}

const toPrincipal = (payload: Record<string, unknown>): AccessPrincipal => {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const tid = typeof payload.tid === 'string' ? payload.tid : ''
  if (!sub || !tid) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid access token claims' })
  }
  return {
    sub,
    tid,
    aud: typeof payload.aud === 'string' ? payload.aud : undefined,
    roles: toStringArray(payload.roles),
    perms: toStringArray(payload.perms),
    clientOnly: payload.client_only === true,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    payload,
  }
}

/** Access tokens die with their session: sign-out, password change and revocation take effect at once here. */
const assertSessionLive = async (event: H3Event, payload: Record<string, unknown>) => {
  if (typeof payload.sid !== 'string' || !payload.sid) return
  const row = await getDb(event)
    .prepare(`SELECT revoked_at FROM sessions WHERE id = ?`)
    .bind(payload.sid)
    .first<{ revoked_at?: number | null }>()
  if (!row || row.revoked_at) throw createError({ statusCode: 401, statusMessage: 'Session revoked' })
}

/** A signed-in user's access token, from any client. Service (client_credentials) tokens are refused. */
export const requireAccessPrincipal = async (event: H3Event): Promise<AccessPrincipal> => {
  const principal = toPrincipal(await readBearerPayload(event))
  if (principal.clientOnly) throw createError({ statusCode: 403, statusMessage: 'User token required' })
  await assertSessionLive(event, principal.payload)
  return principal
}

/**
 * Clients whose tokens may drive the account center and the admin console: the default
 * (account) client plus ADMIN_CLIENT_IDS. A token handed to any other app is never enough
 * for admin work, even when the user is an admin.
 */
export const adminClientIds = (event: H3Event) => {
  const extra = (getEnv(event).ADMIN_CLIENT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
  return new Set([resolveDefaultClientId(event), ...extra])
}

const isAdminPrincipal = (principal: AccessPrincipal) =>
  principal.roles.includes('admin') || principal.perms.includes('manage:users') || principal.perms.includes('manage:admin')

const requireAdminAudience = (event: H3Event, principal: AccessPrincipal) => {
  if (!principal.aud || !adminClientIds(event).has(principal.aud)) {
    throw createError({ statusCode: 403, statusMessage: 'Sign in through the account center for admin access' })
  }
}

export const requireTenantAdmin = async (event: H3Event, tenantId: string): Promise<AccessPrincipal> => {
  const principal = await requireAccessPrincipal(event)
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  if (principal.tid !== tenantId) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }
  requireAdminAudience(event, principal)
  if (!isAdminPrincipal(principal)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  return principal
}

/** Tenant id of the account center's own client; its admins run the platform (app bootstrap). */
export const platformTenantId = async (event: H3Event) => {
  const configured = (getEnv(event).PLATFORM_TENANT_ID || '').trim()
  if (configured) return configured
  const row = await getDb(event)
    .prepare(`SELECT tenant_id FROM clients WHERE client_id = ?`)
    .bind(resolveDefaultClientId(event))
    .first<{ tenant_id: string }>()
  if (!row?.tenant_id) throw createError({ statusCode: 500, statusMessage: 'Platform tenant not configured' })
  return row.tenant_id
}

/** Admin of the platform tenant — not merely admin of some app's tenant. */
export const requirePlatformAdmin = async (event: H3Event): Promise<AccessPrincipal> =>
  requireTenantAdmin(event, await platformTenantId(event))

/**
 * Either a tenant admin (user token from the account center), or a service token of that
 * tenant carrying `scope` — for backends such as billing webhooks and entitlement checks.
 */
export const requireTenantAdminOrService = async (event: H3Event, tenantId: string, scope: string): Promise<AccessPrincipal> => {
  const principal = toPrincipal(await readBearerPayload(event))
  if (!principal.clientOnly) return requireTenantAdmin(event, tenantId)
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  if (principal.tid !== tenantId) throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  if (!principal.scopes.includes(scope)) throw createError({ statusCode: 403, statusMessage: `Scope ${scope} required` })
  return principal
}

/** A user token (any client), or a service token carrying `scope`. Callers check tenant and target user. */
export const requireUserOrServiceScope = async (event: H3Event, scope: string): Promise<AccessPrincipal> => {
  const principal = toPrincipal(await readBearerPayload(event))
  if (!principal.clientOnly) {
    await assertSessionLive(event, principal.payload)
    return principal
  }
  if (!principal.scopes.includes(scope)) throw createError({ statusCode: 403, statusMessage: `Scope ${scope} required` })
  return principal
}
