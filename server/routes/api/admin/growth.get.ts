import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { getDb } from '../../../utils/env'
import { requireTenantAdmin } from '../../../utils/guard'
import { clampLimit } from '../../../utils/admin-console'

const DAY = 86400

/**
 * GET /api/admin/growth?tenant_id=&days=30 — users of one app (tenant): total, new per day, and
 * active users. "Active" = signed in or refreshed a session that day (sessions.created_at or
 * rotated_at), so an app that keeps one long session per device still counts its users.
 * Computed on read from users / sessions (admin page only; no extra writes or indexes).
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantId = String(query.tenant_id || '')
  await requireTenantAdmin(event, tenantId)
  setResponseHeader(event, 'cache-control', 'no-store')
  const days = clampLimit(query.days, 30, 90)
  const now = Math.floor(Date.now() / 1000)
  const todayStart = now - (now % DAY)
  const since = todayStart - (days - 1) * DAY
  const db = getDb(event)

  const [total, newRows, activeRows, windows] = await Promise.all([
    db.prepare(`SELECT count(*) AS n FROM users WHERE tenant_id = ?`).bind(tenantId).first<{ n: number }>(),
    db
      .prepare(`SELECT (created_at - created_at % ${DAY}) AS day, count(*) AS n FROM users WHERE tenant_id = ? AND created_at >= ? GROUP BY day`)
      .bind(tenantId, since)
      .all<{ day: number; n: number }>(),
    db
      .prepare(
        `SELECT day, count(DISTINCT user_id) AS n FROM (
           SELECT user_id, created_at - created_at % ${DAY} AS day FROM sessions WHERE tenant_id = ? AND created_at >= ?
           UNION ALL
           SELECT user_id, rotated_at - rotated_at % ${DAY} AS day FROM sessions WHERE tenant_id = ? AND rotated_at >= ?
         ) GROUP BY day`,
      )
      .bind(tenantId, since, tenantId, since)
      .all<{ day: number; n: number }>(),
    db
      .prepare(
        `SELECT
           count(DISTINCT CASE WHEN last >= ? THEN user_id END) AS dau,
           count(DISTINCT CASE WHEN last >= ? THEN user_id END) AS wau,
           count(DISTINCT CASE WHEN last >= ? THEN user_id END) AS mau
         FROM (SELECT user_id, max(created_at, COALESCE(rotated_at, 0)) AS last FROM sessions WHERE tenant_id = ? AND max(created_at, COALESCE(rotated_at, 0)) >= ?)`,
      )
      .bind(now - DAY, now - 7 * DAY, now - 30 * DAY, tenantId, now - 30 * DAY)
      .first<{ dau: number; wau: number; mau: number }>(),
  ])

  const byDay = (rows: { day: number; n: number }[] | undefined) => new Map((rows || []).map((r) => [Number(r.day), Number(r.n)]))
  const created = byDay(newRows.results)
  const active = byDay(activeRows.results)
  const daily = Array.from({ length: days }, (_, i) => {
    const day = since + i * DAY
    return { day: new Date(day * 1000).toISOString().slice(0, 10), new_users: created.get(day) || 0, active_users: active.get(day) || 0 }
  })

  return {
    tenant_id: tenantId,
    days,
    total_users: Number(total?.n || 0),
    active: { dau: Number(windows?.dau || 0), wau: Number(windows?.wau || 0), mau: Number(windows?.mau || 0) },
    daily,
  }
})
