import { createError, getQuery, H3Event } from 'h3'
import { getDb } from './env'
import { ensureBillingSchema } from './billing'
import { requireUserOrServiceScope, type AccessPrincipal } from './guard'

const isAdminPrincipal = (principal: { roles: string[]; perms: string[] }) =>
  principal.roles.includes('admin') || principal.perms.includes('manage:users') || principal.perms.includes('manage:admin')

/**
 * Whose entitlements an entitlement read is about, and who is asking. A user token reads its
 * own (admins of the tenant may name another user); a service token with
 * `billing:entitlements.read` must name the user. Always inside the token's tenant.
 */
export const resolveEntitlementTarget = async (event: H3Event) => {
  await ensureBillingSchema(event)
  const principal: AccessPrincipal = await requireUserOrServiceScope(event, 'billing:entitlements.read')
  const query = getQuery(event)

  const tenantId = String(query.tenant_id || principal.tid)
  // A service token has no user of its own, so it must name one.
  const targetUserId = String(query.user_id || (principal.clientOnly ? '' : principal.sub))
  const asOf = query.as_of ? Number(query.as_of) : Math.floor(Date.now() / 1000)

  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  if (!targetUserId) {
    throw createError({ statusCode: 400, statusMessage: 'user_id required' })
  }
  if (!Number.isFinite(asOf) || asOf <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'as_of must be a unix timestamp' })
  }
  if (tenantId !== principal.tid) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }
  if (targetUserId !== principal.sub && !principal.clientOnly && !isAdminPrincipal(principal)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin required for cross-user entitlement query' })
  }

  const user = await getDb(event)
    .prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`)
    .bind(targetUserId, tenantId)
    .first<{ id: string }>()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found in tenant' })
  }

  // The app asking: the token's audience for user tokens, the client itself for service tokens.
  const clientId = principal.clientOnly ? principal.sub.replace(/^client:/, '') : principal.aud || ''
  return { principal, tenantId, targetUserId, asOf: Math.floor(asOf), clientId, query }
}
