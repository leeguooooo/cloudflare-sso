import { describe, expect, it } from 'vitest'
import { buildAccountDeletionStatements } from '../../server/utils/account-deletion'

const ALL_TABLES = new Set([
  'tenants', 'global_accounts', 'global_external_identities', 'users', 'credentials', 'clients',
  'auth_codes', 'sessions', 'email_tokens', 'roles', 'permissions', 'role_permissions', 'client_roles',
  'user_roles', 'audit_logs', 'products', 'plans', 'subscriptions', 'entitlements', 'subscription_events',
  'api_keys', 'ipcheck_usage_daily', 'ipcheck_score_hist',
])

const tableOf = (sql: string) => /(?:FROM|UPDATE)\s+(\w+)/.exec(sql)?.[1]

describe('buildAccountDeletionStatements', () => {
  it('deletes children before parents and ends with the global account', () => {
    const stmts = buildAccountDeletionStatements(['u1', 'u2'], 'ga1', ALL_TABLES)
    const order = stmts.map((s) => tableOf(s.sql))
    expect(order).toEqual([
      'ipcheck_usage_daily', 'api_keys', 'entitlements', 'subscription_events', 'subscriptions', 'user_roles',
      'sessions', 'auth_codes', 'email_tokens', 'credentials', 'audit_logs', 'users',
      'global_external_identities', 'global_accounts',
    ])
    const users = stmts.find((s) => s.sql.startsWith('DELETE FROM users'))!
    expect(users.sql).toContain('IN (?, ?)')
    expect(users.params).toEqual(['u1', 'u2'])
    expect(stmts.at(-1)!.params).toEqual(['ga1'])
  })

  it('never deletes shared tables (tenants, clients, roles, plans)', () => {
    const stmts = buildAccountDeletionStatements(['u1'], 'ga1', ALL_TABLES)
    for (const s of stmts) {
      expect(['tenants', 'clients', 'roles', 'permissions', 'plans', 'products']).not.toContain(tableOf(s.sql))
    }
    const audit = stmts.find((s) => tableOf(s.sql) === 'audit_logs')!
    expect(audit.sql.startsWith('UPDATE')).toBe(true)
  })

  it('skips tables missing from this database', () => {
    const minimal = new Set(['users', 'sessions', 'credentials', 'global_accounts'])
    const order = buildAccountDeletionStatements(['u1'], 'ga1', minimal).map((s) => tableOf(s.sql))
    expect(order).toEqual(['sessions', 'credentials', 'users', 'global_accounts'])
  })

  it('handles a legacy user without a global account', () => {
    const stmts = buildAccountDeletionStatements(['u1'], null, ALL_TABLES)
    expect(stmts.some((s) => /global_accounts|api_keys|global_external_identities/.test(s.sql))).toBe(false)
    expect(stmts.some((s) => s.sql.startsWith('DELETE FROM users'))).toBe(true)
  })
})
