import { defineEventHandler, setResponseHeader } from 'h3'
import { getDb } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'
import center from './center.get'

/**
 * GET /api/account/export — everything the identity service keeps about the caller, as a
 * JSON download: profile, sign-in methods, sessions, the full activity log, subscriptions and
 * entitlements in every tenant. Content inside each app (e.g. clipboard history) lives in that
 * app and is not included.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const db = getDb(event)
  const overview = (await center(event)) as Record<string, unknown>
  const gaid = ctx.globalAccount?.id || ctx.user.global_account_id || null
  const userIds = gaid
    ? ((await db.prepare(`SELECT id FROM users WHERE global_account_id = ?`).bind(gaid).all<{ id: string }>()).results || []).map((r) => r.id)
    : [ctx.user.id]
  const inList = userIds.map(() => '?').join(', ')
  const all = async (sql: string) => (await db.prepare(sql).bind(...userIds).all()).results || []
  const tableExists = async (name: string) =>
    Boolean(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first())

  const tenantUsers = await all(`SELECT id, tenant_id, email, locale, status, created_at FROM users WHERE id IN (${inList})`)
  const activity = await all(
    `SELECT action, ip, user_agent, payload_json, created_at FROM audit_logs WHERE user_id IN (${inList}) ORDER BY created_at DESC LIMIT 5000`,
  )
  const subscriptions = (await tableExists('subscriptions'))
    ? await all(`SELECT * FROM subscriptions WHERE user_id IN (${inList}) ORDER BY started_at DESC`)
    : []
  const entitlements = (await tableExists('entitlements'))
    ? await all(`SELECT * FROM entitlements WHERE user_id IN (${inList}) ORDER BY valid_from DESC`)
    : []

  await writeAuditLog(event, { tenantId: ctx.user.tenant_id, userId: ctx.user.id, action: 'account.export', payload: {} })

  const stamp = new Date().toISOString().slice(0, 10)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'content-disposition', `attachment; filename="leeguoo-account-${stamp}.json"`)
  setResponseHeader(event, 'cache-control', 'no-store')
  return {
    exported_at: new Date().toISOString(),
    account: overview.profile,
    sign_in_methods: overview.linked_identities,
    tenant_users: tenantUsers,
    sessions: overview.sessions,
    activity,
    subscriptions,
    entitlements,
  }
})
