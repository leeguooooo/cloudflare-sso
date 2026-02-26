import { createError, defineEventHandler, readBody } from 'h3'
import { writeAuditLog } from '../../../utils/audit'
import { ensureBillingSchema } from '../../../utils/billing'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'

type PlanManageBody = {
  action?: 'create' | 'update' | 'archive' | 'unarchive'
  tenant_id?: string
  id?: string
  product_id?: string
  plan_key?: string
  name?: string
  billing_cycle?: 'monthly' | 'yearly' | 'one_time' | 'custom'
  currency?: string
  amount_minor?: number
  trial_days?: number
  entitlement_keys?: string[]
  meta?: Record<string, unknown>
}

const ALLOWED_BILLING_CYCLE = new Set(['monthly', 'yearly', 'one_time', 'custom'])

const normalizeEntitlementKeys = (input: unknown) => {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

const isObjectPayload = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const body = (await readBody(event)) as PlanManageBody
  const action = body.action || 'create'
  const tenantId = body.tenant_id?.trim()
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  const principal = await requireTenantAdmin(event, tenantId)
  const db = getDb(event)

  if (action === 'create') {
    const productId = body.product_id?.trim()
    const planKey = body.plan_key?.trim()
    const name = body.name?.trim()
    const billingCycle = body.billing_cycle?.trim() || 'monthly'
    const currency = (body.currency || 'USD').trim().toUpperCase()
    const amountMinor = Number(body.amount_minor ?? 0)
    const trialDays = Number(body.trial_days ?? 0)
    const entitlementKeys = normalizeEntitlementKeys(body.entitlement_keys)

    if (!productId || !planKey || !name) {
      throw createError({ statusCode: 400, statusMessage: 'product_id, plan_key, name are required' })
    }
    if (!ALLOWED_BILLING_CYCLE.has(billingCycle)) {
      throw createError({ statusCode: 400, statusMessage: 'invalid billing_cycle' })
    }
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      throw createError({ statusCode: 400, statusMessage: 'amount_minor must be >= 0' })
    }
    if (!Number.isFinite(trialDays) || trialDays < 0) {
      throw createError({ statusCode: 400, statusMessage: 'trial_days must be >= 0' })
    }

    const product = await db
      .prepare(`SELECT id, tenant_id FROM products WHERE id = ?`)
      .bind(productId)
      .first<{ id: string; tenant_id: string }>()
    if (!product) {
      throw createError({ statusCode: 404, statusMessage: 'product_id not found' })
    }
    if (product.tenant_id !== tenantId) {
      throw createError({ statusCode: 400, statusMessage: 'product tenant mismatch' })
    }

    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO plans
         (id, tenant_id, product_id, plan_key, name, billing_cycle, currency, amount_minor, trial_days, entitlement_keys_json, status, meta_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, strftime('%s', 'now'), strftime('%s', 'now'))`,
      )
      .bind(
        id,
        tenantId,
        productId,
        planKey,
        name,
        billingCycle,
        currency,
        Math.floor(amountMinor),
        Math.floor(trialDays),
        JSON.stringify(entitlementKeys),
        JSON.stringify(isObjectPayload(body.meta) ? body.meta : {}),
      )
      .run()

    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: 'billing.plan.create',
      payload: { id, product_id: productId, plan_key: planKey, name, billing_cycle: billingCycle },
    })
    return { success: true, action, id }
  }

  const planId = body.id?.trim()
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }
  const existing = await db
    .prepare(
      `SELECT id, tenant_id, product_id, plan_key, name, billing_cycle, currency, amount_minor, trial_days, entitlement_keys_json, status, meta_json
       FROM plans
       WHERE id = ?`,
    )
    .bind(planId)
    .first<{
      id: string
      tenant_id: string
      product_id: string
      plan_key: string
      name: string
      billing_cycle: string
      currency: string
      amount_minor: number
      trial_days: number
      entitlement_keys_json: string
      status: string
      meta_json: string
    }>()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Plan not found' })
  }
  if (existing.tenant_id !== tenantId) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }

  if (action === 'archive' || action === 'unarchive') {
    const status = action === 'archive' ? 'archived' : 'active'
    await db
      .prepare(`UPDATE plans SET status = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(status, planId)
      .run()
    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: action === 'archive' ? 'billing.plan.archive' : 'billing.plan.unarchive',
      payload: { id: planId, status },
    })
    return { success: true, action, id: planId, status }
  }

  if (action !== 'update') {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported action' })
  }

  const nextProductId = body.product_id?.trim() || existing.product_id
  const nextPlanKey = body.plan_key?.trim() || existing.plan_key
  const nextName = body.name?.trim() || existing.name
  const nextBillingCycle = body.billing_cycle?.trim() || existing.billing_cycle
  const nextCurrency = (body.currency || existing.currency).trim().toUpperCase()
  const nextAmountMinor = body.amount_minor === undefined ? existing.amount_minor : Number(body.amount_minor)
  const nextTrialDays = body.trial_days === undefined ? existing.trial_days : Number(body.trial_days)
  const nextEntitlements =
    body.entitlement_keys === undefined
      ? JSON.parse(existing.entitlement_keys_json || '[]')
      : normalizeEntitlementKeys(body.entitlement_keys)

  if (!ALLOWED_BILLING_CYCLE.has(nextBillingCycle)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid billing_cycle' })
  }
  if (!Number.isFinite(nextAmountMinor) || nextAmountMinor < 0) {
    throw createError({ statusCode: 400, statusMessage: 'amount_minor must be >= 0' })
  }
  if (!Number.isFinite(nextTrialDays) || nextTrialDays < 0) {
    throw createError({ statusCode: 400, statusMessage: 'trial_days must be >= 0' })
  }

  const product = await db
    .prepare(`SELECT id, tenant_id FROM products WHERE id = ?`)
    .bind(nextProductId)
    .first<{ id: string; tenant_id: string }>()
  if (!product) {
    throw createError({ statusCode: 404, statusMessage: 'product_id not found' })
  }
  if (product.tenant_id !== tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'product tenant mismatch' })
  }

  await db
    .prepare(
      `UPDATE plans
       SET product_id = ?, plan_key = ?, name = ?, billing_cycle = ?, currency = ?, amount_minor = ?, trial_days = ?, entitlement_keys_json = ?, meta_json = ?, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
    )
    .bind(
      nextProductId,
      nextPlanKey,
      nextName,
      nextBillingCycle,
      nextCurrency,
      Math.floor(nextAmountMinor),
      Math.floor(nextTrialDays),
      JSON.stringify(nextEntitlements),
      JSON.stringify(isObjectPayload(body.meta) ? body.meta : JSON.parse(existing.meta_json || '{}')),
      planId,
    )
    .run()

  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'billing.plan.update',
    payload: {
      id: planId,
      product_id: nextProductId,
      plan_key: nextPlanKey,
      billing_cycle: nextBillingCycle,
      amount_minor: Math.floor(nextAmountMinor),
      trial_days: Math.floor(nextTrialDays),
      entitlement_keys: nextEntitlements,
    },
  })

  return { success: true, action, id: planId }
})
