import { H3Event } from 'h3'
import { getDb } from './env'

export type RoleWithPermissions = {
  id: string
  name: string
  description: string
  permissions: string[]
}

export const getUserRolesForClient = async (event: H3Event, userId: string, tenantId: string, clientId?: string) => {
  const db = getDb(event)
  // roles directly assigned to user for the client or global (client_id IS NULL)
  const rows = await db
    .prepare(
      `SELECT r.id, r.name, r.description, r.built_in
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND r.tenant_id = ? AND (ur.client_id IS NULL OR ur.client_id = ?)`,
    )
    .bind(userId, tenantId, clientId || null)
    .all<{ id: string; name: string; description: string }>()

  // roles available to this client
  const clientRoleRows = await db
    .prepare(
      `SELECT r.id, r.name, r.description
       FROM client_roles cr
       JOIN roles r ON r.id = cr.role_id
       WHERE cr.client_id = ?`,
    )
    .bind(clientId || '')
    .all<{ id: string; name: string; description: string }>()

  const combined: Record<string, RoleWithPermissions> = {}
  for (const role of [...rows, ...clientRoleRows]) {
    combined[role.id] = { ...role, permissions: [] }
  }
  if (!Object.keys(combined).length) return []

  const roleIds = Object.keys(combined)
  const placeholders = roleIds.map(() => '?').join(',')
  const perms = await db
    .prepare(
      `SELECT rp.role_id, p.action, p.resource
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id IN (${placeholders})`,
    )
    .bind(...roleIds)
    .all<{ role_id: string; action: string; resource: string }>()
  for (const perm of perms) {
    if (combined[perm.role_id]) {
      combined[perm.role_id].permissions.push(`${perm.action}:${perm.resource}`)
    }
  }
  return Object.values(combined)
}

export const flattenPermissions = (roles: RoleWithPermissions[]) => {
  const set = new Set<string>()
  for (const role of roles) {
    role.permissions.forEach((p) => set.add(p))
  }
  return Array.from(set)
}
