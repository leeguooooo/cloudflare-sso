import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { writeAuditLog } from '../../../utils/audit'

type PermissionBody = {
  tenant_id?: string
  action?: string
  resource?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as PermissionBody
  const tenantId = body.tenant_id
  const action = body.action?.trim()
  const resource = body.resource?.trim()
  if (!tenantId || !action || !resource) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id, action, resource required' })
  }
  const principal = await requireTenantAdmin(event, tenantId)
  const db = getDb(event)
  const existing = await db
    .prepare(`SELECT id FROM permissions WHERE tenant_id = ? AND action = ? AND resource = ?`)
    .bind(tenantId, action, resource)
    .first<{ id: string }>()
  if (existing) return { success: true, permission_id: existing.id }
  const permId = crypto.randomUUID()
  await db.prepare(`INSERT INTO permissions (id, tenant_id, action, resource) VALUES (?, ?, ?, ?)`).bind(permId, tenantId, action, resource).run()
  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'access.permission.create',
    payload: { permission_id: permId, action, resource },
  })
  return { success: true, permission_id: permId }
})
