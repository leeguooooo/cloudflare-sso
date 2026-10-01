/**
 * Account merge: one person ended up with two global accounts (e.g. signed up with
 * Google on the web, later with Apple on the iPhone) and links the second account's
 * provider identity from the first. The OTHER account ("from") is folded into the
 * signed-in one ("to"):
 *
 *   - from's sign-in methods (provider identities, API keys) move to `to`;
 *   - if only `from` has a password the user chose, `to` takes over from's email +
 *     password so that sign-in keeps working (otherwise from's email/password stops);
 *   - per tenant: tenant users of `from` are re-pointed to `to`, or — where `to`
 *     already has a user in that tenant — their subscriptions, entitlements, roles and
 *     audit trail move over and the duplicate user is deleted;
 *   - connected apps move their data through their merge hook (account-hooks.ts);
 *   - `from` is deleted.
 *
 * Proof of ownership: `to` is the signed-in session (fresh: linking requires a recent
 * sign-in) and `from` was just proven by the provider round trip that found it.
 *
 * Failure safety / idempotency:
 *   1. from's sessions are revoked first, so no app keeps writing under `from`;
 *   2. app hooks run (each app's merge is atomic and idempotent) — a refusal (E2EE)
 *      or failure stops here with both accounts intact, retryable;
 *   3. the issuer side runs as ONE D1 batch (a transaction);
 *   4. app hooks run once more to sweep anything written in between;
 *   5. the proposal is marked done. Re-running any step is harmless.
 */
import { createError, H3Event } from 'h3'
import { callAccountHooks, type HookResult } from './account-hooks'
import { hasAdminRole, listExistingTables } from './account-deletion'
import { getDb } from './env'
import { ensureGlobalIdentitySchema } from './identity'

export const MERGE_PROPOSAL_TTL_SECONDS = 30 * 60
export const MERGE_RETRY_WINDOW_SECONDS = 24 * 60 * 60

export type MergeStatus = 'proposed' | 'running' | 'refused' | 'failed' | 'done' | 'cancelled'

export type MergeProposal = {
  id: string
  from_global_account_id: string
  to_global_account_id: string
  provider: string
  subject: string
  status: MergeStatus
  error?: string | null
  detail_json?: string | null
  expires_at: number
  created_at: number
  updated_at: number
}

export type MergeAccountRow = {
  id: string
  email: string
  password_hash: string
  password_set?: number | null
  display_name?: string | null
  avatar_url?: string | null
}

export type TenantUserRow = { id: string; tenant_id: string }

export type Statement = { sql: string; params: unknown[] }

const now = () => Math.floor(Date.now() / 1000)

/** Whether `to` takes over from's email + password (only `from` has a real password). */
export const adoptsFromPassword = (from: Pick<MergeAccountRow, 'password_set'>, to: Pick<MergeAccountRow, 'password_set'>) =>
  from.password_set === 1 && to.password_set !== 1

/** Ordered, transactional issuer-side statements. Pure: unit tested. */
export const buildIssuerMergeStatements = (input: {
  from: MergeAccountRow
  to: MergeAccountRow
  fromUsers: TenantUserRow[]
  toUsers: TenantUserRow[]
  tables: Set<string>
  mergeId: string
  nowSeconds: number
}): Statement[] => {
  const { from, to, tables, nowSeconds } = input
  const out: Statement[] = []
  const push = (table: string, sql: string, params: unknown[]) => {
    if (tables.has(table)) out.push({ sql, params })
  }
  const adopt = adoptsFromPassword(from, to)
  const finalEmail = adopt ? from.email : to.email

  for (const u of input.fromUsers) {
    const v = input.toUsers.find((candidate) => candidate.tenant_id === u.tenant_id)
    if (v) {
      push('subscriptions', `UPDATE subscriptions SET user_id = ? WHERE user_id = ?`, [v.id, u.id])
      push('entitlements', `UPDATE OR IGNORE entitlements SET user_id = ? WHERE user_id = ?`, [v.id, u.id])
      push('entitlements', `DELETE FROM entitlements WHERE user_id = ?`, [u.id])
      push(
        'user_roles',
        `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, client_id, created_at)
         SELECT lower(hex(randomblob(16))), ?, role_id, client_id, created_at FROM user_roles WHERE user_id = ?`,
        [v.id, u.id],
      )
      push('user_roles', `DELETE FROM user_roles WHERE user_id = ?`, [u.id])
      push('sessions', `DELETE FROM sessions WHERE user_id = ?`, [u.id])
      push('auth_codes', `DELETE FROM auth_codes WHERE user_id = ?`, [u.id])
      push('email_tokens', `DELETE FROM email_tokens WHERE user_id = ?`, [u.id])
      push('credentials', `DELETE FROM credentials WHERE user_id = ?`, [u.id])
      push('audit_logs', `UPDATE audit_logs SET user_id = ? WHERE user_id = ?`, [v.id, u.id])
      push('users', `DELETE FROM users WHERE id = ?`, [u.id])
    } else {
      push('sessions', `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [nowSeconds, u.id])
      push('users', `UPDATE users SET global_account_id = ?, updated_at = ? WHERE id = ?`, [to.id, nowSeconds, u.id])
    }
  }

  push('global_external_identities', `UPDATE global_external_identities SET global_account_id = ? WHERE global_account_id = ?`, [to.id, from.id])
  push('api_keys', `UPDATE api_keys SET global_account_id = ? WHERE global_account_id = ?`, [to.id, from.id])
  push('global_accounts', `DELETE FROM global_accounts WHERE id = ?`, [from.id])
  if (adopt) {
    push(
      'global_accounts',
      `UPDATE global_accounts SET email = ?, password_hash = ?, password_set = 1, updated_at = ? WHERE id = ?`,
      [from.email, from.password_hash, nowSeconds, to.id],
    )
  }
  push(
    'global_accounts',
    `UPDATE global_accounts
     SET display_name = COALESCE(NULLIF(display_name, ''), ?),
         avatar_url = COALESCE(NULLIF(avatar_url, ''), ?),
         updated_at = ?
     WHERE id = ?`,
    [from.display_name || null, from.avatar_url || null, nowSeconds, to.id],
  )
  // Tenant users carry the account email (tokens' `email` claim). Skip rows where a
  // tenant-local legacy user already holds that address.
  push('users', `UPDATE OR IGNORE users SET email = ? WHERE global_account_id = ?`, [finalEmail, to.id])
  push(
    'account_merges',
    `UPDATE account_merges SET status = 'done', error = NULL, updated_at = ? WHERE id = ?`,
    [nowSeconds, input.mergeId],
  )
  return out
}

export const createMergeProposal = async (
  event: H3Event,
  input: { fromGlobalAccountId: string; toGlobalAccountId: string; provider: string; subject: string },
) => {
  await ensureGlobalIdentitySchema(event)
  const db = getDb(event)
  const id = crypto.randomUUID()
  await db
    .prepare(
      `UPDATE account_merges SET status = 'cancelled', updated_at = ?
       WHERE to_global_account_id = ? AND from_global_account_id = ? AND status = 'proposed'`,
    )
    .bind(now(), input.toGlobalAccountId, input.fromGlobalAccountId)
    .run()
  await db
    .prepare(
      `INSERT INTO account_merges (id, from_global_account_id, to_global_account_id, provider, subject, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?)`,
    )
    .bind(id, input.fromGlobalAccountId, input.toGlobalAccountId, input.provider, input.subject, now() + MERGE_PROPOSAL_TTL_SECONDS)
    .run()
  return id
}

/** The caller's proposal, or 404. */
export const loadMergeProposal = async (event: H3Event, id: string, toGlobalAccountId: string) => {
  await ensureGlobalIdentitySchema(event)
  const row = await getDb(event)
    .prepare(`SELECT * FROM account_merges WHERE id = ? AND to_global_account_id = ?`)
    .bind(id, toGlobalAccountId)
    .first<MergeProposal>()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Merge request not found' })
  return row
}

export const isProposalActionable = (proposal: Pick<MergeProposal, 'status' | 'expires_at' | 'created_at'>, nowSeconds = now()) => {
  if (proposal.status === 'proposed') return nowSeconds <= proposal.expires_at
  if (proposal.status === 'failed' || proposal.status === 'running') {
    return nowSeconds <= proposal.created_at + MERGE_RETRY_WINDOW_SECONDS
  }
  return false
}

const loadAccount = (db: D1Database, id: string) =>
  db
    .prepare(`SELECT id, email, password_hash, password_set, display_name, avatar_url, created_at FROM global_accounts WHERE id = ?`)
    .bind(id)
    .first<MergeAccountRow & { created_at: number }>()

const loadUsers = async (db: D1Database, gaid: string) =>
  ((await db.prepare(`SELECT id, tenant_id FROM users WHERE global_account_id = ?`).bind(gaid).all<TenantUserRow>()).results || [])

/** What the confirmation screen shows about the other account. */
export const describeAccount = async (event: H3Event, gaid: string) => {
  const db = getDb(event)
  const account = await loadAccount(db, gaid)
  if (!account) return null
  const identities =
    (
      await db
        .prepare(`SELECT provider, email, is_private_email FROM global_external_identities WHERE global_account_id = ? ORDER BY created_at`)
        .bind(gaid)
        .all<{ provider: string; email?: string | null; is_private_email?: number | null }>()
    ).results || []
  const apps =
    (
      await db
        .prepare(
          `SELECT DISTINCT c.name AS name FROM sessions s
           JOIN users u ON u.id = s.user_id
           JOIN clients c ON c.id = s.client_id
           WHERE u.global_account_id = ?`,
        )
        .bind(gaid)
        .all<{ name: string }>()
    ).results || []
  return {
    email: account.email,
    created_at: Number(account.created_at || 0),
    has_password: account.password_set === 1,
    sign_in_methods: identities.map((row) => ({
      provider: row.provider,
      email: row.email || null,
      is_private_email: row.is_private_email === 1,
    })),
    apps: [...new Set(apps.map((row) => row.name).filter(Boolean))],
  }
}

/** Dry run of every connected app's merge (E2EE refusal, counts). */
export const precheckMerge = (event: H3Event, proposal: MergeProposal) =>
  callAccountHooks(event, 'merge', {
    fromUserId: proposal.from_global_account_id,
    toUserId: proposal.to_global_account_id,
    dryRun: true,
  })

const setStatus = (db: D1Database, id: string, status: MergeStatus, error: string | null, detail?: unknown) =>
  db
    .prepare(`UPDATE account_merges SET status = ?, error = ?, detail_json = COALESCE(?, detail_json), updated_at = ? WHERE id = ?`)
    .bind(status, error, detail === undefined ? null : JSON.stringify(detail), now(), id)
    .run()

const refusalOf = (results: HookResult[]) => results.find((result) => !result.ok)

export const executeMerge = async (event: H3Event, proposal: MergeProposal) => {
  const db = getDb(event)
  const fromId = proposal.from_global_account_id
  const toId = proposal.to_global_account_id
  const to = await loadAccount(db, toId)
  if (!to) throw createError({ statusCode: 404, statusMessage: 'Current account no longer exists' })

  const from = await loadAccount(db, fromId)
  if (!from) {
    // Issuer side already merged (an earlier attempt died after the batch): just sweep.
    const sweep = await callAccountHooks(event, 'merge', { fromUserId: fromId, toUserId: toId })
    await setStatus(db, proposal.id, 'done', null, { sweep })
    return { status: 'done' as const, hooks: sweep }
  }

  const tables = await listExistingTables(db)
  const fromUsers = await loadUsers(db, fromId)
  if (await hasAdminRole(db, fromUsers.map((u) => u.id), tables)) {
    await setStatus(db, proposal.id, 'refused', 'admin account')
    throw createError({ statusCode: 409, statusMessage: 'The other account is an administrator account and cannot be merged. Contact support.' })
  }

  await setStatus(db, proposal.id, 'running', null)

  // 1. Sign the other account out everywhere so nothing keeps writing under it.
  if (fromUsers.length) {
    await db
      .prepare(
        `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE global_account_id = ?)`,
      )
      .bind(now(), fromId)
      .run()
  }

  // 2. Connected apps move their data.
  const hooks = await callAccountHooks(event, 'merge', { fromUserId: fromId, toUserId: toId })
  const refusal = refusalOf(hooks)
  if (refusal) {
    const refused = refusal.status === 409
    await setStatus(db, proposal.id, refused ? 'refused' : 'failed', refusal.message || refusal.code || 'hook failed', { hooks })
    throw createError({
      statusCode: refused ? 409 : 502,
      statusMessage: refusal.message || 'A connected app could not merge the accounts. Nothing was changed; try again later.',
      data: { code: refusal.code || null },
    })
  }

  // 3. Issuer side, atomically.
  const toUsers = await loadUsers(db, toId)
  const statements = buildIssuerMergeStatements({
    from,
    to,
    fromUsers,
    toUsers,
    tables,
    mergeId: proposal.id,
    nowSeconds: now(),
  })
  await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)))

  // 4. Sweep anything written between 2 and 3 (best effort; the merge is done either way).
  const sweep = await callAccountHooks(event, 'merge', { fromUserId: fromId, toUserId: toId })
  await setStatus(db, proposal.id, 'done', null, { hooks, sweep })
  return { status: 'done' as const, hooks, adoptedPassword: adoptsFromPassword(from, to) }
}
