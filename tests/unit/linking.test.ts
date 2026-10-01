import { describe, expect, it } from 'vitest'
import { resolveProviderAvailability } from '../../utils/auth-client'
import { adoptsFromPassword, buildIssuerMergeStatements, isProposalActionable } from '../../server/utils/account-merge'
import { mayAutoLinkByEmail } from '../../server/utils/oauth-complete'
import { canRemoveIdentity, isRecentAuth, type SignInMethod } from '../../server/utils/sign-in-methods'
import { listHookBases } from '../../server/utils/account-hooks'

const policy = (over: Partial<Parameters<typeof resolveProviderAvailability>[0]>) =>
  resolveProviderAvailability({
    clientId: 'misonote-app-web',
    appleConfigured: true,
    siwaFlag: '1',
    siwaPreview: false,
    storeSocialFlag: false,
    ...over,
  })

describe('provider availability (Guideline 4.8)', () => {
  it('web clients always get Google/GitHub; Apple when configured and enabled', () => {
    expect(policy({})).toEqual({ apple: true, google: true, github: true })
    expect(policy({ siwaFlag: '' })).toEqual({ apple: false, google: true, github: true })
    expect(policy({ appleConfigured: false })).toEqual({ apple: false, google: true, github: true })
  })

  it('store clients never see Google/GitHub without Apple next to them', () => {
    for (const clientId of ['leeguoo-pastyx-ios', 'misonote-paste-macos']) {
      expect(policy({ clientId, siwaFlag: '', storeSocialFlag: true })).toEqual({ apple: false, google: false, github: false })
      expect(policy({ clientId, appleConfigured: false, storeSocialFlag: true })).toEqual({ apple: false, google: false, github: false })
      // Apple on, store flag still off: Apple only.
      expect(policy({ clientId })).toEqual({ apple: true, google: false, github: false })
      // Both flags on: everything.
      expect(policy({ clientId, storeSocialFlag: true })).toEqual({ apple: true, google: true, github: true })
      // Preview mode never unlocks social for store clients.
      expect(policy({ clientId, siwaFlag: 'test', siwaPreview: true, storeSocialFlag: true })).toEqual({ apple: true, google: false, github: false })
    }
  })

  it('test mode shows Apple only with ?siwa=1', () => {
    expect(policy({ siwaFlag: 'test' }).apple).toBe(false)
    expect(policy({ siwaFlag: 'test', siwaPreview: true }).apple).toBe(true)
  })

  it('extra store ids from env are honoured', () => {
    expect(policy({ clientId: 'new-store-app', extraStoreIds: 'a,new-store-app', siwaFlag: '' }).google).toBe(false)
  })
})

describe('auto-link by email', () => {
  it('only for provider-verified Google/GitHub emails, never Apple', () => {
    expect(mayAutoLinkByEmail({ provider: 'google', email: 'a@x.com', emailVerified: true })).toBe(true)
    expect(mayAutoLinkByEmail({ provider: 'github', email: 'a@x.com', emailVerified: true })).toBe(true)
    expect(mayAutoLinkByEmail({ provider: 'google', email: 'a@x.com', emailVerified: false })).toBe(false)
    expect(mayAutoLinkByEmail({ provider: 'github', email: 'a@x.com' })).toBe(false)
    expect(mayAutoLinkByEmail({ provider: 'apple', email: 'a@x.com', emailVerified: true })).toBe(false)
  })
})

describe('sign-in methods', () => {
  const provider = (id: string): SignInMethod => ({
    kind: 'provider', id, provider: 'google', email: null, is_private_email: false, email_disabled: false, consent_revoked: false, name: null, created_at: 0,
  })
  it('never removes the last method', () => {
    expect(canRemoveIdentity([provider('a')], 'a')).toBe(false)
    expect(canRemoveIdentity([provider('a'), provider('b')], 'a')).toBe(true)
    expect(canRemoveIdentity([{ kind: 'password', email: 'x' }, provider('a')], 'a')).toBe(true)
  })
  it('recent auth = signed in within 15 minutes', () => {
    expect(isRecentAuth(1000, 1000 + 900)).toBe(true)
    expect(isRecentAuth(1000, 1000 + 901)).toBe(false)
    expect(isRecentAuth(null, 1000)).toBe(false)
  })
})

describe('merge statements', () => {
  const tables = new Set([
    'global_accounts', 'global_external_identities', 'users', 'sessions', 'auth_codes', 'email_tokens', 'credentials',
    'user_roles', 'audit_logs', 'subscriptions', 'entitlements', 'api_keys', 'account_merges',
  ])
  const from = { id: 'B', email: 'b@x.com', password_hash: 'hashB', password_set: 1, display_name: 'Bee', avatar_url: null }
  const to = { id: 'A', email: 'relay@privaterelay.appleid.com', password_hash: 'rand', password_set: 0, display_name: null, avatar_url: null }

  it('moves identities, deletes the other account, adopts its password when only it has one', () => {
    const stmts = buildIssuerMergeStatements({
      from, to, tables, mergeId: 'm1', nowSeconds: 50,
      fromUsers: [{ id: 'ub1', tenant_id: 't1' }, { id: 'ub2', tenant_id: 't2' }],
      toUsers: [{ id: 'ua1', tenant_id: 't1' }],
    })
    const sql = stmts.map((s) => s.sql.replace(/\s+/g, ' '))
    // t1 collides: billing moves to ua1 and ub1 is deleted.
    expect(stmts.find((s) => s.sql.startsWith('UPDATE subscriptions'))!.params).toEqual(['ua1', 'ub1'])
    expect(stmts.find((s) => s.sql.startsWith('DELETE FROM users'))!.params).toEqual(['ub1'])
    // t2 does not: ub2 is re-pointed.
    expect(stmts.find((s) => s.sql.startsWith('UPDATE users SET global_account_id'))!.params).toEqual(['A', 50, 'ub2'])
    const identities = sql.findIndex((s) => s.startsWith('UPDATE global_external_identities'))
    const del = sql.findIndex((s) => s.startsWith('DELETE FROM global_accounts'))
    const adopt = sql.findIndex((s) => s.includes('password_set = 1'))
    expect(identities).toBeGreaterThanOrEqual(0)
    expect(identities).toBeLessThan(del)
    expect(del).toBeLessThan(adopt) // email is freed before `to` takes it
    expect(stmts[adopt].params).toEqual(['b@x.com', 'hashB', 50, 'A'])
    expect(sql.at(-1)).toContain("status = 'done'")
  })

  it('keeps the current password when both accounts have one', () => {
    expect(adoptsFromPassword({ password_set: 1 }, { password_set: 1 })).toBe(false)
    const stmts = buildIssuerMergeStatements({ from, to: { ...to, password_set: 1 }, tables, mergeId: 'm', nowSeconds: 1, fromUsers: [], toUsers: [] })
    expect(stmts.some((s) => s.sql.includes('password_set = 1'))).toBe(false)
  })

  it('skips tables that do not exist', () => {
    const stmts = buildIssuerMergeStatements({ from, to, tables: new Set(['global_accounts', 'users']), mergeId: 'm', nowSeconds: 1, fromUsers: [], toUsers: [] })
    expect(stmts.some((s) => /api_keys|account_merges|global_external_identities/.test(s.sql))).toBe(false)
  })

  it('proposals expire; failed ones stay retryable for a day', () => {
    expect(isProposalActionable({ status: 'proposed', expires_at: 100, created_at: 0 }, 100)).toBe(true)
    expect(isProposalActionable({ status: 'proposed', expires_at: 100, created_at: 0 }, 101)).toBe(false)
    expect(isProposalActionable({ status: 'failed', expires_at: 100, created_at: 0 }, 5000)).toBe(true)
    expect(isProposalActionable({ status: 'done', expires_at: 100, created_at: 0 }, 1)).toBe(false)
    expect(isProposalActionable({ status: 'refused', expires_at: 100, created_at: 0 }, 1)).toBe(false)
  })
})

describe('account hooks', () => {
  it('parses hook base urls', () => {
    expect(listHookBases(' https://a.example/v1/internal/accounts/ , ftp://x, http://127.0.0.1:8791/v1/internal/accounts')).toEqual([
      'https://a.example/v1/internal/accounts',
      'http://127.0.0.1:8791/v1/internal/accounts',
    ])
  })
})
