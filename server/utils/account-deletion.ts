/**
 * Self-service deletion of a global account (App Store Guideline 5.1.1(v)).
 *
 * Removes the caller's global account and everything keyed to it across ALL
 * tenants: every per-tenant `users` row mapped to the account, their
 * credentials, sessions / refresh tokens, auth codes, email tokens, role
 * assignments, billing rows, linked social identities and API keys. Audit
 * log rows are kept for security accounting but detached (user_id -> NULL).
 *
 * Statements for tables that do not exist in this database are skipped, and
 * children are deleted before parents so it works whether or not the
 * database enforces foreign keys (D1 does).
 */

export type AccountDeletionTarget = {
  /** users.id of the caller (the access token's `sub`). */
  userId: string
  /** global_accounts.id, when the caller is mapped to a global account. */
  globalAccountId: string | null
}

export type DeletionStatement = { sql: string; params: unknown[] }

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')

/** Resolves every tenant user row that belongs to the account. */
export const collectAccountUserIds = async (db: D1Database, target: AccountDeletionTarget): Promise<string[]> => {
  const ids = new Set<string>([target.userId])
  if (target.globalAccountId) {
    const rows = await db
      .prepare(`SELECT id FROM users WHERE global_account_id = ?`)
      .bind(target.globalAccountId)
      .all<{ id: string }>()
    for (const row of rows.results || []) {
      if (row?.id) ids.add(row.id)
    }
  }
  return [...ids]
}

export const listExistingTables = async (db: D1Database): Promise<Set<string>> => {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all<{ name: string }>()
  return new Set((rows.results || []).map((row) => row.name).filter(Boolean))
}

/** Accounts holding an `admin` role anywhere are protected from self-deletion. */
export const hasAdminRole = async (db: D1Database, userIds: string[], tables: Set<string>): Promise<boolean> => {
  if (!userIds.length || !tables.has('user_roles') || !tables.has('roles')) return false
  const row = await db
    .prepare(
      `SELECT 1 AS hit
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id IN (${placeholders(userIds.length)}) AND lower(r.name) = 'admin'
       LIMIT 1`,
    )
    .bind(...userIds)
    .first<{ hit: number }>()
  return Boolean(row?.hit)
}

/** Ordered statements that delete the account. Pure: easy to unit test. */
export const buildAccountDeletionStatements = (
  userIds: string[],
  globalAccountId: string | null,
  tables: Set<string>,
): DeletionStatement[] => {
  const out: DeletionStatement[] = []
  const push = (table: string, sql: string, params: unknown[]) => {
    if (tables.has(table)) out.push({ sql, params })
  }

  if (globalAccountId) {
    if (tables.has('api_keys')) {
      push(
        'ipcheck_usage_daily',
        `DELETE FROM ipcheck_usage_daily WHERE key_id IN (SELECT id FROM api_keys WHERE global_account_id = ?)`,
        [globalAccountId],
      )
    }
    push('api_keys', `DELETE FROM api_keys WHERE global_account_id = ?`, [globalAccountId])
  }

  if (userIds.length) {
    const inList = placeholders(userIds.length)
    push('entitlements', `DELETE FROM entitlements WHERE user_id IN (${inList})`, userIds)
    if (tables.has('subscriptions')) {
      push(
        'subscription_events',
        `DELETE FROM subscription_events WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id IN (${inList}))`,
        userIds,
      )
    }
    push('subscriptions', `DELETE FROM subscriptions WHERE user_id IN (${inList})`, userIds)
    push('user_roles', `DELETE FROM user_roles WHERE user_id IN (${inList})`, userIds)
    push('sessions', `DELETE FROM sessions WHERE user_id IN (${inList})`, userIds)
    push('auth_codes', `DELETE FROM auth_codes WHERE user_id IN (${inList})`, userIds)
    push('email_tokens', `DELETE FROM email_tokens WHERE user_id IN (${inList})`, userIds)
    push('credentials', `DELETE FROM credentials WHERE user_id IN (${inList})`, userIds)
    push('audit_logs', `UPDATE audit_logs SET user_id = NULL WHERE user_id IN (${inList})`, userIds)
    push('users', `DELETE FROM users WHERE id IN (${inList})`, userIds)
  }

  if (globalAccountId) {
    push(
      'global_external_identities',
      `DELETE FROM global_external_identities WHERE global_account_id = ?`,
      [globalAccountId],
    )
    push('trial_grants', `DELETE FROM trial_grants WHERE global_account_id = ?`, [globalAccountId])
    push('global_accounts', `DELETE FROM global_accounts WHERE id = ?`, [globalAccountId])
  }

  return out
}

/** Runs the statements atomically (D1 batch = one transaction). */
export const executeAccountDeletion = async (db: D1Database, statements: DeletionStatement[]) => {
  if (!statements.length) return
  await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)))
}
