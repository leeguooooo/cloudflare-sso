import { createError, getRequestHeader, H3Event } from 'h3'
import { verifyJwt } from './jwt'

export type AccessPrincipal = {
  sub: string
  tid: string
  aud?: string
  roles: string[]
  perms: string[]
  payload: Record<string, unknown>
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export const requireAccessPrincipal = async (event: H3Event): Promise<AccessPrincipal> => {
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing access token' })
  }

  const token = authHeader.slice('Bearer '.length)
  const payload = (await verifyJwt(event, token)) as Record<string, unknown>
  if (payload.token_use && payload.token_use !== 'access') {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token use' })
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const tid = typeof payload.tid === 'string' ? payload.tid : ''
  if (!sub || !tid) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid access token claims' })
  }

  const aud = typeof payload.aud === 'string' ? payload.aud : undefined
  const roles = toStringArray(payload.roles)
  const perms = toStringArray(payload.perms)

  return {
    sub,
    tid,
    aud,
    roles,
    perms,
    payload,
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

  const isAdmin = principal.roles.includes('admin') || principal.perms.includes('manage:users') || principal.perms.includes('manage:admin')
  if (!isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }

  return principal
}

export const requireAnyAdmin = async (event: H3Event): Promise<AccessPrincipal> => {
  const principal = await requireAccessPrincipal(event)
  const isAdmin = principal.roles.includes('admin') || principal.perms.includes('manage:users') || principal.perms.includes('manage:admin')
  if (!isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  return principal
}
