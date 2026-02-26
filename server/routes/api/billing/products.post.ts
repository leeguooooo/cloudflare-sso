import { createError, defineEventHandler, readBody } from 'h3'
import { writeAuditLog } from '../../../utils/audit'
import { ensureBillingSchema } from '../../../utils/billing'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'

type ProductManageBody = {
  action?: 'create' | 'update' | 'archive' | 'unarchive'
  tenant_id?: string
  id?: string
  product_key?: string
  name?: string
  app_key?: string
  meta?: Record<string, unknown>
}

const isObjectPayload = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const body = (await readBody(event)) as ProductManageBody
  const action = body.action || 'create'
  const tenantId = body.tenant_id?.trim()
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  const principal = await requireTenantAdmin(event, tenantId)
  const db = getDb(event)

  if (action === 'create') {
    const productKey = body.product_key?.trim()
    const name = body.name?.trim()
    const appKey = body.app_key?.trim()
    if (!productKey || !name || !appKey) {
      throw createError({ statusCode: 400, statusMessage: 'product_key, name, app_key are required' })
    }
    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO products
         (id, tenant_id, product_key, name, app_key, status, meta_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, strftime('%s', 'now'), strftime('%s', 'now'))`,
      )
      .bind(id, tenantId, productKey, name, appKey, JSON.stringify(isObjectPayload(body.meta) ? body.meta : {}))
      .run()

    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: 'billing.product.create',
      payload: { id, product_key: productKey, name, app_key: appKey },
    })
    return { success: true, action, id }
  }

  const productId = body.id?.trim()
  if (!productId) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }
  const existing = await db
    .prepare(`SELECT id, tenant_id, product_key, name, app_key, status FROM products WHERE id = ?`)
    .bind(productId)
    .first<{ id: string; tenant_id: string; product_key: string; name: string; app_key: string; status: string }>()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Product not found' })
  }
  if (existing.tenant_id !== tenantId) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }

  if (action === 'archive' || action === 'unarchive') {
    const status = action === 'archive' ? 'archived' : 'active'
    await db
      .prepare(`UPDATE products SET status = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(status, productId)
      .run()
    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: action === 'archive' ? 'billing.product.archive' : 'billing.product.unarchive',
      payload: { id: productId, status },
    })
    return { success: true, action, id: productId, status }
  }

  if (action !== 'update') {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported action' })
  }

  const nextKey = body.product_key?.trim() || existing.product_key
  const nextName = body.name?.trim() || existing.name
  const nextAppKey = body.app_key?.trim() || existing.app_key
  const nextMeta = JSON.stringify(isObjectPayload(body.meta) ? body.meta : {})

  await db
    .prepare(
      `UPDATE products
       SET product_key = ?, name = ?, app_key = ?, meta_json = ?, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
    )
    .bind(nextKey, nextName, nextAppKey, nextMeta, productId)
    .run()

  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'billing.product.update',
    payload: { id: productId, product_key: nextKey, name: nextName, app_key: nextAppKey },
  })

  return { success: true, action, id: productId }
})
