import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { getUserRolesForClient, flattenPermissions } from '../../../utils/access'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  const clientPublicId = query.client_id ? String(query.client_id) : undefined
  const userId = query.user_id ? String(query.user_id) : undefined
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })

  const db = getDb(event)
  const client = clientPublicId
    ? await db
        .prepare(`SELECT id, client_id FROM clients WHERE client_id = ? AND tenant_id = ?`)
        .bind(clientPublicId, tenantId)
        .first<{ id: string; client_id: string }>()
    : null
  const clientId = client?.id

  const roles = await db
    .prepare(`SELECT id, name, description FROM roles WHERE tenant_id = ? ORDER BY name`)
    .bind(tenantId)
    .all<{ id: string; name: string; description: string }>()
  const perms = await db
    .prepare(`SELECT id, action, resource FROM permissions WHERE tenant_id = ? ORDER BY action, resource`)
    .bind(tenantId)
    .all<{ id: string; action: string; resource: string }>()
  const rolePerms = await db
    .prepare(
      `SELECT rp.role_id, p.action, p.resource
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.tenant_id = ?`,
    )
    .bind(tenantId)
    .all<{ role_id: string; action: string; resource: string }>()

  const rolePermissions: Record<string, string[]> = {}
  for (const rp of rolePerms) {
    rolePermissions[rp.role_id] = rolePermissions[rp.role_id] || []
    rolePermissions[rp.role_id].push(`${rp.action}:${rp.resource}`)
  }

  const clientRoleMap: Record<string, string[]> = {}
  if (clientId) {
    const cr = await db
      .prepare(`SELECT role_id FROM client_roles WHERE client_id = ?`)
      .bind(clientId)
      .all<{ role_id: string }>()
    clientRoleMap[clientId] = cr.map((r) => r.role_id)
  }

  let userAssignments: string[] = []
  let userRoleNames: string[] = []
  let userPerms: string[] = []
  if (userId && clientId) {
    const userRoles = await getUserRolesForClient(event, userId, tenantId, clientId)
    userAssignments = userRoles.map((r) => r.id)
    userRoleNames = userRoles.map((r) => r.name)
    userPerms = flattenPermissions(userRoles)
  }

  return {
    roles: roles.map((r) => ({ ...r, permissions: rolePermissions[r.id] || [] })),
    permissions: perms.map((p) => `${p.action}:${p.resource}`),
    client_roles: clientRoleMap,
    user_roles: userAssignments,
    user_role_names: userRoleNames,
    user_permissions: userPerms,
  }
})
