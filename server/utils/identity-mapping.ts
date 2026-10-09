import { H3Event } from 'h3'
import { getDb } from './env'
import { oncePerDb } from './schema-once'
import { randomId } from './crypto'
import { createGlobalAccount, findGlobalAccountByEmail, findGlobalAccountById, provisionTenantUserForGlobalAccount } from './identity'

/**
 * Moving an app's existing users onto SSO: each legacy user (`source_system` + `source_user_id`)
 * is mapped to one global account and its user in the app's tenant. Imports are idempotent and
 * deterministic, every mapping is recorded with who made it, and a mapping can be reverted.
 *
 * Rules, per record:
 * - already mapped (active)                         → `unchanged`
 * - `global_account_id` given (an admin's decision)  → `manual`
 * - email verified at the source + account exists    → `linked`
 * - email verified + no account + `create_missing`   → `created` (no password; the user signs in
 *   with a provider or sets one through "forgot password")
 * - anything else (unverified email, no account)     → `needs_review`, nothing written
 * An unverified email is never trusted: anyone could have typed someone else's address into
 * the old app, and linking on it would hand them that person's SSO account.
 */

const mappingSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS identity_mappings (
         id TEXT PRIMARY KEY,
         tenant_id TEXT NOT NULL,
         source_system TEXT NOT NULL,
         source_user_id TEXT NOT NULL,
         global_account_id TEXT NOT NULL,
         user_id TEXT NOT NULL,
         outcome TEXT NOT NULL CHECK (outcome IN ('linked', 'created', 'manual')),
         status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
         run_id TEXT,
         mapped_by TEXT NOT NULL,
         mapped_at INTEGER NOT NULL,
         reverted_by TEXT,
         reverted_at INTEGER
       )`,
    )
    .run()
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_mappings_active
       ON identity_mappings (tenant_id, source_system, source_user_id) WHERE status = 'active'`,
    )
    .run()
})

export const ensureIdentityMappingSchema = (event: H3Event) => mappingSchema(getDb(event))

export type MappingRecordInput = {
  source_user_id?: unknown
  email?: unknown
  email_verified?: unknown
  global_account_id?: unknown
  display_name?: unknown
}

export type MappingOutcome = 'unchanged' | 'linked' | 'created' | 'manual' | 'needs_review' | 'invalid'

export type MappingResult = {
  source_user_id: string
  outcome: MappingOutcome
  reason?: string
  global_account_id?: string
  /** The app's `sub` for this person from now on (the tenant user id). Absent on a dry run for new users. */
  user_id?: string
  mapping_id?: string
}

export type MappingRow = {
  id: string
  tenant_id: string
  source_system: string
  source_user_id: string
  global_account_id: string
  user_id: string
  outcome: 'linked' | 'created' | 'manual'
  status: 'active' | 'reverted'
  run_id: string | null
  mapped_by: string
  mapped_at: number
  reverted_by: string | null
  reverted_at: number | null
}

export const SOURCE_SYSTEM_RE = /^[a-z][a-z0-9_-]{1,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const findActiveMapping = (event: H3Event, tenantId: string, sourceSystem: string, sourceUserId: string) =>
  getDb(event)
    .prepare(`SELECT * FROM identity_mappings WHERE tenant_id = ? AND source_system = ? AND source_user_id = ? AND status = 'active'`)
    .bind(tenantId, sourceSystem, sourceUserId)
    .first<MappingRow>()

const text = (value: unknown, max = 320) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '')

/** Maps one legacy user. With `dryRun` nothing is written; the outcome is what a real run would do. */
export const mapLegacyUser = async (
  event: H3Event,
  input: { tenantId: string; sourceSystem: string; record: MappingRecordInput; createMissing: boolean; dryRun: boolean; actor: string; runId: string },
): Promise<MappingResult> => {
  const sourceUserId = text(input.record.source_user_id, 128)
  if (!sourceUserId) return { source_user_id: '', outcome: 'invalid', reason: 'source_user_id required' }

  const existing = await findActiveMapping(event, input.tenantId, input.sourceSystem, sourceUserId)
  if (existing) {
    return { source_user_id: sourceUserId, outcome: 'unchanged', global_account_id: existing.global_account_id, user_id: existing.user_id, mapping_id: existing.id }
  }

  const explicitId = text(input.record.global_account_id, 64)
  const email = text(input.record.email).toLowerCase()
  const verified = input.record.email_verified === true

  let account = explicitId ? await findGlobalAccountById(event, explicitId) : null
  let outcome: 'linked' | 'created' | 'manual'
  if (explicitId) {
    if (!account) return { source_user_id: sourceUserId, outcome: 'invalid', reason: 'global_account_id not found' }
    outcome = 'manual'
  } else {
    if (!email || !EMAIL_RE.test(email)) return { source_user_id: sourceUserId, outcome: 'invalid', reason: 'valid email or global_account_id required' }
    if (!verified) return { source_user_id: sourceUserId, outcome: 'needs_review', reason: 'email not verified at the source' }
    account = await findGlobalAccountByEmail(event, email)
    if (account) outcome = 'linked'
    else if (input.createMissing) outcome = 'created'
    else return { source_user_id: sourceUserId, outcome: 'needs_review', reason: 'no SSO account with this email' }
  }
  if (account && account.status !== 'active') {
    return { source_user_id: sourceUserId, outcome: 'needs_review', reason: `SSO account is ${account.status}`, global_account_id: account.id }
  }

  if (input.dryRun) return { source_user_id: sourceUserId, outcome, global_account_id: account?.id }

  let globalAccountId = account?.id || ''
  let accountEmail = account?.email || email
  if (!account) {
    // No password the user knows: an unusable marker (not a PBKDF2 hash, so it never verifies).
    globalAccountId = await createGlobalAccount(event, {
      email,
      passwordHash: `unset$${randomId(24)}`,
      passwordSet: false,
      displayName: text(input.record.display_name, 120) || null,
    })
    accountEmail = email
  }
  const provisioned = await provisionTenantUserForGlobalAccount(event, {
    tenantId: input.tenantId,
    globalAccountId,
    email: accountEmail,
    locale: account?.locale || 'en',
  })

  const id = crypto.randomUUID()
  const inserted = await getDb(event)
    .prepare(
      `INSERT OR IGNORE INTO identity_mappings
         (id, tenant_id, source_system, source_user_id, global_account_id, user_id, outcome, status, run_id, mapped_by, mapped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(id, input.tenantId, input.sourceSystem, sourceUserId, globalAccountId, provisioned.user.id, outcome, input.runId, input.actor, Math.floor(Date.now() / 1000))
    .run()
  if (!Number(inserted.meta?.changes || 0)) {
    // A concurrent import mapped it first: report theirs.
    const winner = await findActiveMapping(event, input.tenantId, input.sourceSystem, sourceUserId)
    return { source_user_id: sourceUserId, outcome: 'unchanged', global_account_id: winner?.global_account_id, user_id: winner?.user_id, mapping_id: winner?.id }
  }
  return { source_user_id: sourceUserId, outcome, global_account_id: globalAccountId, user_id: provisioned.user.id, mapping_id: id }
}
