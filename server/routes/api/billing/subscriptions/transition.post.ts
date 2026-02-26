import { createError, defineEventHandler, readBody } from 'h3'
import { writeAuditLog } from '../../../../utils/audit'
import { ensureBillingSchema } from '../../../../utils/billing'
import { getDb } from '../../../../utils/env'
import { requireTenantAdmin } from '../../../../utils/guard'

type TransitionBody = {
  tenant_id?: string
  subscription_id?: string
  status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
  current_period_start?: number | null
  current_period_end?: number | null
  cancel_at_period_end?: boolean
  canceled_at?: number | null
}

type SubscriptionRow = {
  id: string
  tenant_id: string
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
  current_period_start: number | null
  current_period_end: number | null
  cancel_at_period_end: number
  canceled_at: number | null
  updated_at: number
}

const ALLOWED_STATUS = new Set(['trialing', 'active', 'past_due', 'canceled', 'expired'])

const parseTimestampField = (value: unknown, field: string): number | null => {
  if (value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be null or unix timestamp` })
  }
  return Math.floor(n)
}

const isTransitionError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  return (
    message.includes('invalid subscription status transition') ||
    message.includes('canceled_at required when status is canceled')
  )
}

export default defineEventHandler(async (event) => {
  await ensureBillingSchema(event)
  const body = (await readBody(event)) as TransitionBody
  const tenantId = body.tenant_id?.trim()
  const subscriptionId = body.subscription_id?.trim()
  const status = body.status?.trim() as TransitionBody['status'] | undefined
  if (!tenantId || !subscriptionId || !status) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id, subscription_id, status are required' })
  }
  if (!ALLOWED_STATUS.has(status)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid status' })
  }

  const principal = await requireTenantAdmin(event, tenantId)
  const db = getDb(event)

  const current = await db
    .prepare(
      `SELECT id, tenant_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, updated_at
       FROM subscriptions
       WHERE id = ?`,
    )
    .bind(subscriptionId)
    .first<SubscriptionRow>()
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Subscription not found' })
  }
  if (current.tenant_id !== tenantId) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }

  const nextStart =
    body.current_period_start === undefined
      ? current.current_period_start
      : parseTimestampField(body.current_period_start, 'current_period_start')
  const nextEnd =
    body.current_period_end === undefined
      ? current.current_period_end
      : parseTimestampField(body.current_period_end, 'current_period_end')
  const nextCancelAtPeriodEnd =
    typeof body.cancel_at_period_end === 'boolean'
      ? (body.cancel_at_period_end ? 1 : 0)
      : current.cancel_at_period_end
  const nextCanceledAt =
    body.canceled_at === undefined
      ? current.canceled_at
      : parseTimestampField(body.canceled_at, 'canceled_at')

  try {
    await db
      .prepare(
        `UPDATE subscriptions
         SET status = ?, current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?, canceled_at = ?, updated_at = strftime('%s', 'now')
         WHERE id = ?`,
      )
      .bind(status, nextStart, nextEnd, nextCancelAtPeriodEnd, nextCanceledAt, subscriptionId)
      .run()
  } catch (error) {
    if (isTransitionError(error)) {
      throw createError({ statusCode: 400, statusMessage: (error as any).message || 'Invalid subscription transition' })
    }
    throw error
  }

  const updated = await db
    .prepare(
      `SELECT id, tenant_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, updated_at
       FROM subscriptions
       WHERE id = ?`,
    )
    .bind(subscriptionId)
    .first<SubscriptionRow>()

  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'billing.subscription.transition',
    payload: {
      subscription_id: subscriptionId,
      from_status: current.status,
      to_status: status,
      cancel_at_period_end: nextCancelAtPeriodEnd === 1,
    },
  })

  return {
    success: true,
    subscription: updated,
  }
})
