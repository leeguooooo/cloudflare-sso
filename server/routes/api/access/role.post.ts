import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'

type RoleBody = {
  tenant_id?: string
  name?: string
  description?: string
  permissions?: string[] // ["action:resource"]
  client_ids?: string[]
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as RoleBody
  const tenantId = body.tenant_id
  const name = body.name?.trim()
  if (!tenantId || !name) throw createError({ statusCode: 400, statusMessage: 'tenant_id and name required' })
  const db = getDb(event)

  // Create role
  const roleId = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO roles (id, tenant_id, name, description, built_in) VALUES (?, ?, ?, ?, 0)`)
    .bind(roleId, tenantId, name, body.description || '')
    .run()

  // Ensure permissions exist
  if (Array.isArray(body.permissions) && body.permissions.length) {
    for (const perm of body.permissions) {
      const [action, resource] = perm.split(':')
      if (!action || !resource) continue
      let permId = (
        await db
          .prepare(`SELECT id FROM permissions WHERE tenant_id = ? AND action = ? AND resource = ?`)
          .bind(tenantId, action, resource)
          .first<{ id: string }>()
      )?.id
      if (!permId) {
        permId = crypto.randomUUID()
        await db.prepare(`INSERT INTO permissions (id, tenant_id, action, resource) VALUES (?, ?, ?, ?)`).bind(permId, tenantId, action, resource).run()
      }
      await db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(roleId, permId).run()
    }
  }

  if (Array.isArray(body.client_ids) && body.client_ids.length) {
    for (const cid of body.client_ids) {
      await db.prepare(`INSERT OR IGNORE INTO client_roles (client_id, role_id) VALUES (?, ?)`).bind(cid, roleId).run()
    }
  }

  return { success: true, role_id: roleId }
})
