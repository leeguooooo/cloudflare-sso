import { createError, defineEventHandler, getQuery } from 'h3'
import { ensureBillingSchema } from '../../../utils/billing'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'

type ProductRow = {
  id: string
  tenant_id: string
  product_key: string
  name: string
  app_key: string
  status: 'active' | 'archived'
  meta_json: string
  created_at: number
  updated_at: number
}

type PlanRow = {
  id: string
  tenant_id: string
  product_id: string
  plan_key: string
  name: string
  billing_cycle: 'monthly' | 'yearly' | 'one_time' | 'custom'
  currency: string
  amount_minor: number
  trial_days: number
  entitlement_keys_json: string
  status: 'active' | 'archived'
  meta_json: string
  created_at: number
  updated_at: number
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  const includeArchived = String(query.include_archived || '') === 'true'
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  await requireTenantAdmin(event, tenantId)

  const db = getDb(event)
  const products = await db
    .prepare(
      `SELECT id, tenant_id, product_key, name, app_key, status, meta_json, created_at, updated_at
       FROM products
       WHERE tenant_id = ?
         AND (? = 1 OR status = 'active')
       ORDER BY created_at DESC`,
    )
    .bind(tenantId, includeArchived ? 1 : 0)
    .all<ProductRow>()
  const plans = await db
    .prepare(
      `SELECT id, tenant_id, product_id, plan_key, name, billing_cycle, currency, amount_minor, trial_days, entitlement_keys_json, status, meta_json, created_at, updated_at
       FROM plans
       WHERE tenant_id = ?
         AND (? = 1 OR status = 'active')
       ORDER BY created_at DESC`,
    )
    .bind(tenantId, includeArchived ? 1 : 0)
    .all<PlanRow>()

  return {
    tenant_id: tenantId,
    products: (products.results || []).map((item) => ({
      ...item,
      meta: JSON.parse(item.meta_json || '{}') as Record<string, unknown>,
    })),
    plans: (plans.results || []).map((item) => ({
      ...item,
      entitlement_keys: JSON.parse(item.entitlement_keys_json || '[]') as string[],
      meta: JSON.parse(item.meta_json || '{}') as Record<string, unknown>,
    })),
  }
})
