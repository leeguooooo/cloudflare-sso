import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'

type ClientRow = {
  id: string
  client_id: string
  name: string
  grant_types: string
  scope: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }

  const db = getDb(event)
  const clients = await db
    .prepare(
      `SELECT id, client_id, name, grant_types, scope
       FROM clients
       WHERE tenant_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(tenantId)
    .all<ClientRow>()

  return {
    tenant_id: tenantId,
    clients: clients.results || [],
  }
})
