import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'

type AssignBody = {
  user_id?: string
  role_id?: string
  client_id?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as AssignBody
  const userId = body.user_id
  const roleId = body.role_id
  const clientId = body.client_id || null
  if (!userId || !roleId) throw createError({ statusCode: 400, statusMessage: 'user_id and role_id required' })

  const db = getDb(event)
  const role = await db.prepare(`SELECT id, tenant_id FROM roles WHERE id = ?`).bind(roleId).first<{ id: string; tenant_id: string }>()
  if (!role) throw createError({ statusCode: 404, statusMessage: 'Role not found' })

  const user = await db
    .prepare(`SELECT id, tenant_id FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; tenant_id: string }>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  if (user.tenant_id !== role.tenant_id) throw createError({ statusCode: 400, statusMessage: 'Tenant mismatch' })

  if (clientId) {
    const client = await db
      .prepare(`SELECT id, tenant_id FROM clients WHERE id = ?`)
      .bind(clientId)
      .first<{ id: string; tenant_id: string }>()
    if (!client) throw createError({ statusCode: 404, statusMessage: 'Client not found' })
    if (client.tenant_id !== role.tenant_id) throw createError({ statusCode: 400, statusMessage: 'Tenant mismatch' })
  }

  await db
    .prepare(`INSERT OR REPLACE INTO user_roles (user_id, role_id, client_id) VALUES (?, ?, ?)`)
    .bind(userId, roleId, clientId)
    .run()

  return { success: true }
})
