import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'

type ScalarRow = {
  c: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }

  const db = getDb(event)

  const users = await db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<ScalarRow>()
  const clients = await db
    .prepare(`SELECT COUNT(*) AS c FROM clients WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<ScalarRow>()
  const roles = await db
    .prepare(`SELECT COUNT(*) AS c FROM roles WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<ScalarRow>()
  const sessions = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM sessions
       WHERE tenant_id = ?
         AND revoked_at IS NULL
         AND expires_at > strftime('%s', 'now')`,
    )
    .bind(tenantId)
    .first<ScalarRow>()

  return {
    tenant_id: tenantId,
    users: Number(users?.c || 0),
    clients: Number(clients?.c || 0),
    roles: Number(roles?.c || 0),
    active_sessions: Number(sessions?.c || 0),
  }
})
