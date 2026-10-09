import { H3Event } from 'h3'
import { getDb } from './env'
import { oncePerDb } from './schema-once'

/**
 * Daily allow/deny counters for entitlement checks, one row per
 * (day, tenant, client, key, result). Cost: each check is one UPSERT on the primary key,
 * no secondary index — 10k checks/day ≈ 300k row writes/month, well inside D1's included
 * 50M. Reads are a 7–30 day range scan for the admin page only.
 */
const metricsSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS entitlement_check_daily (
         day TEXT NOT NULL,
         tenant_id TEXT NOT NULL,
         client_id TEXT NOT NULL,
         entitlement_key TEXT NOT NULL,
         result TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
         count INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (tenant_id, day, client_id, entitlement_key, result)
       ) WITHOUT ROWID`,
    )
    .run()
})

export const ensureEntitlementMetricsSchema = (event: H3Event) => metricsSchema(getDb(event))

export const utcDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)

/** Counts one check. Never throws: a metrics hiccup must not deny anyone access. */
export const recordEntitlementCheck = async (
  event: H3Event,
  input: { tenantId: string; clientId: string; entitlementKey: string; allowed: boolean },
) => {
  try {
    await ensureEntitlementMetricsSchema(event)
    await getDb(event)
      .prepare(
        `INSERT INTO entitlement_check_daily (day, tenant_id, client_id, entitlement_key, result, count)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (tenant_id, day, client_id, entitlement_key, result) DO UPDATE SET count = count + 1`,
      )
      .bind(utcDay(Math.floor(Date.now() / 1000)), input.tenantId, input.clientId || 'unknown', input.entitlementKey, input.allowed ? 'allowed' : 'denied')
      .run()
  } catch (error) {
    console.warn('entitlement check metric failed', { error: error instanceof Error ? error.message : String(error) })
  }
}
