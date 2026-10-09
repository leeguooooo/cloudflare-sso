import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { requirePlatformAdmin } from '../../../../utils/guard'
import { writeAuditLog } from '../../../../utils/audit'
import { ensureBillingSchema } from '../../../../utils/billing'
import { processSubscriptionEvent } from '../../../../utils/billing-events'

type Action = 'suspend' | 'restore' | 'revoke_sessions' | 'grant_entitlement' | 'revoke_entitlement'
const ACTIONS: readonly Action[] = ['suspend', 'restore', 'revoke_sessions', 'grant_entitlement', 'revoke_entitlement']

type Body = {
  action?: Action
  tenant_id?: string
  entitlement_key?: string
  /** unix seconds; omitted = no end */
  valid_to?: number | null
  note?: string
}

/**
 * POST /api/admin/accounts/:id { action, ... } — platform admin actions on one global account.
 * - `suspend` / `restore`: the account cannot sign in to any app while suspended; suspending
 *   signs it out everywhere at once.
 * - `revoke_sessions`: sign out of every app and device.
 * - `grant_entitlement` / `revoke_entitlement` { tenant_id, entitlement_key, valid_to? }: a manual
 *   entitlement, recorded as a `manual` billing event so it shows in the billing event log.
 *   Revoking only ends manual grants; paid and trial entitlements follow their own events.
 */
export default defineEventHandler(async (event) => {
  const principal = await requirePlatformAdmin(event)
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Body
  const action = body.action
  if (!action || !ACTIONS.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: `action must be one of: ${ACTIONS.join(', ')}` })
  }

  const db = getDb(event)
  const account = await db.prepare(`SELECT id, email, status FROM global_accounts WHERE id = ?`).bind(id).first<{ id: string; email: string; status: string }>()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })

  const self = await db.prepare(`SELECT global_account_id FROM users WHERE id = ?`).bind(principal.sub).first<{ global_account_id: string | null }>()
  if (action === 'suspend' && self?.global_account_id === id) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot suspend your own account' })
  }

  const audit = (payload: Record<string, unknown>) =>
    writeAuditLog(event, { tenantId: principal.tid, userId: principal.sub, action: `admin.account.${action}`, payload: { target_global_account_id: id, ...payload } })

  const revokeAll = db
    .prepare(
      `UPDATE sessions SET revoked_at = strftime('%s', 'now')
       WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE global_account_id = ?)`,
    )
    .bind(id)

  if (action === 'suspend' || action === 'restore') {
    const status = action === 'suspend' ? 'disabled' : 'active'
    const update = db.prepare(`UPDATE global_accounts SET status = ?, updated_at = strftime('%s', 'now') WHERE id = ?`).bind(status, id)
    await (action === 'suspend' ? db.batch([update, revokeAll]) : update.run())
    await audit({ previous_status: account.status, note: body.note || undefined })
    return { ok: true, status }
  }

  if (action === 'revoke_sessions') {
    const result = await revokeAll.run()
    await audit({ revoked: result.meta?.changes ?? null })
    return { ok: true }
  }

  const tenantId = String(body.tenant_id || '').trim()
  const key = String(body.entitlement_key || '').trim()
  if (!tenantId || !key) throw createError({ statusCode: 400, statusMessage: 'tenant_id and entitlement_key are required' })
  if (!/^[a-z0-9][a-z0-9._:-]{0,99}$/i.test(key)) throw createError({ statusCode: 400, statusMessage: 'Invalid entitlement_key' })
  const tenant = await db.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenantId).first<{ id: string }>()
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })

  const occurredAt = Math.floor(Date.now() / 1000)
  const validTo = body.valid_to == null ? null : Math.floor(Number(body.valid_to))
  if (action === 'grant_entitlement' && validTo !== null && (!Number.isFinite(validTo) || validTo <= occurredAt)) {
    throw createError({ statusCode: 400, statusMessage: 'valid_to must be in the future' })
  }

  await ensureBillingSchema(event)
  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    subscription_id: null,
    provider: 'manual',
    event_id: `admin:${crypto.randomUUID()}`,
    event_type: action === 'grant_entitlement' ? 'entitlement.granted' : 'entitlement.revoked',
    occurred_at: occurredAt,
    payload_json: JSON.stringify({
      global_account_id: id,
      entitlement_key: key,
      ...(validTo !== null ? { valid_to: validTo } : {}),
      granted_by: principal.sub,
      ...(body.note ? { note: String(body.note).slice(0, 200) } : {}),
    }),
  }
  await db
    .prepare(
      `INSERT INTO subscription_events (id, tenant_id, subscription_id, provider, event_id, event_type, occurred_at, payload_json, status)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(row.id, row.tenant_id, row.provider, row.event_id, row.event_type, row.occurred_at, row.payload_json)
    .run()
  const outcome = await processSubscriptionEvent(event, row)
  await audit({ tenant_id: tenantId, entitlement_key: key, valid_to: validTo, event_id: row.event_id, status: outcome.status })
  if (outcome.status === 'failed') throw createError({ statusCode: 400, statusMessage: outcome.error || 'Entitlement change failed' })
  return { ok: true, event_id: row.event_id, status: outcome.status }
})
