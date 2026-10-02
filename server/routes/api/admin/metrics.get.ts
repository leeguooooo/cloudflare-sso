import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'

/** Audit actions counted by each metric. */
const METRICS: Record<string, string[]> = {
  login_success: ['auth.login', 'auth.oauth_login', 'auth.wechat_miniprogram'],
  login_failure: ['auth.login_failed'],
  token_issued: ['auth.token.authorization_code'],
  refresh: ['auth.token.refresh_token', 'auth.refresh'],
  logout: ['auth.logout', 'auth.logout.rp'],
  revoked: ['auth.token.revoke', 'account.session.revoke', 'admin.user.revoke_sessions'],
}
const DAILY = ['login_success', 'login_failure', 'token_issued', 'refresh'] as const

const metricOf = (action: string) => Object.keys(METRICS).find((key) => METRICS[key].includes(action))

/**
 * GET /api/admin/metrics?tenant_id=&days=7 — sign-in health from the audit log: totals, a
 * per-day series and per-client token activity. Enough to notice a regression (failures up,
 * refreshes down) without an external dashboard.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  const daysRaw = Number(query.days || 7)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 90) : 7
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const actions = Object.values(METRICS).flat()
  const placeholders = actions.map(() => '?').join(', ')
  const db = getDb(event)

  const daily = await db
    .prepare(
      `SELECT date(created_at, 'unixepoch') AS day, action, count(*) AS n
       FROM audit_logs
       WHERE tenant_id = ? AND created_at >= ? AND action IN (${placeholders})
       GROUP BY day, action`,
    )
    .bind(tenantId, since, ...actions)
    .all<{ day: string; action: string; n: number }>()

  const byClient = await db
    .prepare(
      `SELECT json_extract(payload_json, '$.client_id') AS client_id, action, count(*) AS n
       FROM audit_logs
       WHERE tenant_id = ? AND created_at >= ? AND action IN ('auth.token.authorization_code', 'auth.token.refresh_token', 'auth.refresh')
       GROUP BY client_id, action`,
    )
    .bind(tenantId, since)
    .all<{ client_id: string | null; action: string; n: number }>()

  const totals: Record<string, number> = Object.fromEntries(Object.keys(METRICS).map((key) => [key, 0]))
  const perDay = new Map<string, Record<string, number>>()
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    perDay.set(day, Object.fromEntries(DAILY.map((key) => [key, 0])))
  }
  for (const row of daily.results || []) {
    const metric = metricOf(row.action)
    if (!metric) continue
    totals[metric] += Number(row.n)
    const bucket = perDay.get(row.day)
    if (bucket && metric in bucket) bucket[metric] += Number(row.n)
  }

  const clients = new Map<string, { client_id: string; token_issued: number; refresh: number }>()
  for (const row of byClient.results || []) {
    const id = row.client_id || 'unknown'
    const entry = clients.get(id) || { client_id: id, token_issued: 0, refresh: 0 }
    if (row.action === 'auth.token.authorization_code') entry.token_issued += Number(row.n)
    else entry.refresh += Number(row.n)
    clients.set(id, entry)
  }

  return {
    days,
    totals,
    daily: [...perDay.entries()].map(([day, counts]) => ({ day, ...counts })),
    by_client: [...clients.values()].sort((a, b) => b.token_issued + b.refresh - (a.token_issued + a.refresh)),
  }
})
