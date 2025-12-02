import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'

type Body = {
  client_id?: string
  role_id?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as Body
  if (!body.client_id || !body.role_id) throw createError({ statusCode: 400, statusMessage: 'client_id and role_id required' })
  const db = getDb(event)
  const client = await db.prepare(`SELECT id, tenant_id FROM clients WHERE id = ?`).bind(body.client_id).first<{ id: string; tenant_id: string }>()
  if (!client) throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  const role = await db.prepare(`SELECT id, tenant_id FROM roles WHERE id = ?`).bind(body.role_id).first<{ id: string; tenant_id: string }>()
  if (!role) throw createError({ statusCode: 404, statusMessage: 'Role not found' })
  if (client.tenant_id !== role.tenant_id) throw createError({ statusCode: 400, statusMessage: 'Tenant mismatch' })
  await db.prepare(`INSERT OR IGNORE INTO client_roles (client_id, role_id) VALUES (?, ?)`).bind(body.client_id, body.role_id).run()
  return { success: true }
})
