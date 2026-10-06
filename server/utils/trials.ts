/**
 * Free trial granted the first time an account signs in to a tenant (e.g. 90 days of JRKAN).
 *
 * TENANT_SIGNUP_TRIALS = '{"tenant-jrkan":{"entitlement_key":"jrkan.premium","days":90}}'
 *
 * `trial_grants` is the ledger: one row per (global account, tenant), ever. The entitlement is
 * written in the same D1 batch and only by the request whose ledger row won, so re-signing in,
 * re-provisioning the tenant user or a concurrent sign-in never grants twice. Account merges
 * carry the ledger over (account-merge.ts), so merging cannot mint a second trial either.
 *
 * The entitlement uses source 'promo' with meta_json {"trial": true, ...}; GET
 * /api/billing/entitlements reports it as `source: "promo"`, `trial: true`.
 */
import { H3Event } from 'h3'
import { ensureBillingSchema } from './billing'
import { nowInSeconds } from './crypto'
import { getDb, getEnv } from './env'
import { oncePerDb } from './schema-once'

export type TrialConfig = { entitlement_key: string; days: number }

export const TRIAL_SOURCE = 'promo'

export const parseTrialConfig = (raw: string | undefined): Record<string, TrialConfig> => {
  if (!raw || !raw.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('tenant_signup_trials is not valid json')
    return {}
  }
  const out: Record<string, TrialConfig> = {}
  for (const [tenantId, value] of Object.entries((parsed || {}) as Record<string, Partial<TrialConfig>>)) {
    const key = typeof value?.entitlement_key === 'string' ? value.entitlement_key.trim() : ''
    const days = Number(value?.days)
    if (key && Number.isFinite(days) && days > 0) out[tenantId] = { entitlement_key: key, days }
  }
  return out
}

const trialSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS trial_grants (
        global_account_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        entitlement_key TEXT NOT NULL,
        entitlement_id TEXT NOT NULL,
        user_id TEXT,
        granted_at INTEGER NOT NULL,
        valid_to INTEGER NOT NULL,
        PRIMARY KEY (global_account_id, tenant_id)
      )`,
    )
    .run()
})

export const ensureTrialSchema = async (event: H3Event) => {
  await ensureBillingSchema(event)
  await trialSchema(getDb(event))
}

/** Grants the tenant's trial to this account unless it ever had one there. True when granted now. */
export const grantSignupTrial = async (
  event: H3Event,
  user: { id: string; tenant_id: string; global_account_id?: string | null },
  nowSeconds = nowInSeconds(),
) => {
  const config = parseTrialConfig(getEnv(event).TENANT_SIGNUP_TRIALS)[user.tenant_id]
  if (!config || !user.global_account_id) return false
  await ensureTrialSchema(event)
  const db = getDb(event)
  const entitlementId = crypto.randomUUID()
  const validTo = nowSeconds + Math.round(config.days * 86400)
  const meta = JSON.stringify({ trial: true, kind: 'signup_trial', days: config.days })
  const [ledger] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO trial_grants (global_account_id, tenant_id, entitlement_key, entitlement_id, user_id, granted_at, valid_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(user.global_account_id, user.tenant_id, config.entitlement_key, entitlementId, user.id, nowSeconds, validTo),
    // Only the request whose ledger row carries this entitlement id writes the entitlement.
    db
      .prepare(
        `INSERT INTO entitlements (id, tenant_id, user_id, subscription_id, entitlement_key, source, status, valid_from, valid_to, meta_json)
         SELECT entitlement_id, tenant_id, ?, NULL, entitlement_key, '${TRIAL_SOURCE}', 'granted', granted_at, valid_to, ?
         FROM trial_grants WHERE global_account_id = ? AND tenant_id = ? AND entitlement_id = ?`,
      )
      .bind(user.id, meta, user.global_account_id, user.tenant_id, entitlementId),
  ])
  return Boolean(ledger?.meta?.changes)
}

/** Every sign-in path calls this; a trial problem must never block signing in. */
export const grantSignupTrialSafely = async (event: H3Event, user: { id: string; tenant_id: string; global_account_id?: string | null }) => {
  try {
    return await grantSignupTrial(event, user)
  } catch (error) {
    console.warn('signup trial grant failed', { tenant_id: user.tenant_id, user_id: user.id, error: String((error as Error)?.message || error) })
    return false
  }
}
