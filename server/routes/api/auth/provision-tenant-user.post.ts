import { createError, defineEventHandler, readBody } from 'h3'
import {
  ensureGlobalIdentitySchema,
  ensureTenantExists,
  findUserById,
  getClientByPublicId,
  provisionTenantUserForGlobalAccount,
} from '../../../utils/identity'
import { platformTenantId, requireAccessPrincipal } from '../../../utils/guard'
import { getDb } from '../../../utils/env'
import { writeAuditLog } from '../../../utils/audit'

type ProvisionBody = {
  client_id?: string
  tenant_id?: string
  tenant_name?: string
}

export default defineEventHandler(async (event) => {
  const principal = await requireAccessPrincipal(event)
  const body = (await readBody(event).catch(() => ({}))) as ProvisionBody

  await ensureGlobalIdentitySchema(event)

  let tenantId = body.tenant_id?.trim() || ''
  if (body.client_id?.trim()) {
    const client = await getClientByPublicId(event, body.client_id.trim())
    tenantId = client.tenant_id
  }

  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'client_id or tenant_id required' })
  }

  const sourceUser = await findUserById(event, principal.sub)
  if (!sourceUser) {
    throw createError({ statusCode: 404, statusMessage: 'Source user not found' })
  }

  const globalAccountIdFromClaim = typeof principal.payload.gaid === 'string' ? principal.payload.gaid : undefined
  const globalAccountId = sourceUser.global_account_id || globalAccountIdFromClaim
  if (!globalAccountId) {
    throw createError({ statusCode: 400, statusMessage: 'Source user is not bound to global account' })
  }

  if (!body.client_id && body.tenant_id) {
    const exists = await getDb(event).prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenantId).first()
    if (!exists) {
      // Creating tenants is a platform operation; a regular user must not squat tenant ids.
      const isPlatformAdmin =
        principal.tid === (await platformTenantId(event)) &&
        (principal.roles.includes('admin') || principal.perms.includes('manage:admin'))
      if (!isPlatformAdmin) throw createError({ statusCode: 404, statusMessage: 'Unknown tenant' })
      await ensureTenantExists(event, tenantId, body.tenant_name || tenantId)
    }
  }

  const provisioned = await provisionTenantUserForGlobalAccount(event, {
    tenantId,
    globalAccountId,
    email: sourceUser.email,
    locale: sourceUser.locale || 'en',
  })

  await writeAuditLog(event, {
    tenantId,
    userId: sourceUser.id,
    action: 'auth.provision_tenant_user',
    payload: {
      global_account_id: globalAccountId,
      target_user_id: provisioned.user.id,
      created: provisioned.created,
      client_id: body.client_id || null,
    },
  })

  return {
    user_id: provisioned.user.id,
    tenant_id: provisioned.user.tenant_id,
    global_account_id: globalAccountId,
    created: provisioned.created,
  }
})
