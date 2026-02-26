import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { ensureClientManagementSchema } from '../../../utils/identity'

type ClientRow = {
  id: string
  client_id: string
  name: string
  redirect_uris: string
  grant_types: string
  scope: string
  first_party: number
  status?: string | null
  updated_at?: number | null
  created_at: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  const includeDisabled = String(query.include_disabled || '') === 'true'
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  await requireTenantAdmin(event, tenantId)
  await ensureClientManagementSchema(event)

  const db = getDb(event)
  const clients = await db
    .prepare(
      `SELECT id, client_id, name, redirect_uris, grant_types, scope, first_party, status, updated_at, created_at
       FROM clients
       WHERE tenant_id = ?
         AND (? = 1 OR COALESCE(status, 'active') = 'active')
       ORDER BY created_at DESC`,
    )
    .bind(tenantId, includeDisabled ? 1 : 0)
    .all<ClientRow>()

  return {
    tenant_id: tenantId,
    clients: (clients.results || []).map((item) => ({
      ...item,
      status: item.status || 'active',
      redirect_uris: JSON.parse(item.redirect_uris || '[]') as string[],
    })),
  }
})
