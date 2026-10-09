import { H3Event } from 'h3'
import { getDb } from './env'
import { oncePerDb } from './schema-once'

/**
 * How much traffic each app still serves through its pre-SSO auth path (header identity, KV
 * session, local cookie…), so a fallback can be removed once it is provably unused. Apps
 * report aggregated counts (not one call per request): one row per day, tenant, app and path.
 * The plan's cut rule: below 0.1% of requests for 7 consecutive days.
 */
const legacySchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS legacy_auth_daily (
         tenant_id TEXT NOT NULL,
         day TEXT NOT NULL,
         client_id TEXT NOT NULL,
         path TEXT NOT NULL,
         legacy_hits INTEGER NOT NULL DEFAULT 0,
         total_requests INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (tenant_id, day, client_id, path)
       ) WITHOUT ROWID`,
    )
    .run()
})

export const ensureLegacyUsageSchema = (event: H3Event) => legacySchema(getDb(event))

export const CUT_THRESHOLD = 0.001
export const CUT_DAYS = 7

/** Adds a report to the day's counters (reports are increments, so apps can send every few minutes). */
export const addLegacyUsage = async (
  event: H3Event,
  input: { tenantId: string; day: string; clientId: string; path: string; legacyHits: number; totalRequests: number },
) => {
  await ensureLegacyUsageSchema(event)
  await getDb(event)
    .prepare(
      `INSERT INTO legacy_auth_daily (tenant_id, day, client_id, path, legacy_hits, total_requests)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, day, client_id, path) DO UPDATE SET
         legacy_hits = legacy_hits + excluded.legacy_hits,
         total_requests = total_requests + excluded.total_requests`,
    )
    .bind(input.tenantId, input.day, input.clientId, input.path, input.legacyHits, input.totalRequests)
    .run()
}

export type LegacyDay = { day: string; legacy_hits: number; total_requests: number }

/** Ready to remove: the last CUT_DAYS days all reported and all under the threshold. */
export const readyToCut = (days: LegacyDay[], today: string) => {
  const recent = days.filter((d) => d.day <= today).sort((a, b) => b.day.localeCompare(a.day)).slice(0, CUT_DAYS)
  if (recent.length < CUT_DAYS) return false
  const first = new Date(`${recent[recent.length - 1].day}T00:00:00Z`).getTime()
  const last = new Date(`${recent[0].day}T00:00:00Z`).getTime()
  if ((last - first) / 86400000 !== CUT_DAYS - 1) return false // a gap means a day without data
  return recent.every((d) => d.total_requests > 0 && d.legacy_hits / d.total_requests < CUT_THRESHOLD)
}
