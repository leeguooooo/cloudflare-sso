import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import token from '../../server/routes/token.post'
import login from '../../server/routes/api/auth/login.post'
import entitlements from '../../server/routes/api/billing/entitlements.get'
import { hashPassword } from '../../server/utils/crypto'
import { listExistingTables } from '../../server/utils/account-deletion'
import { buildIssuerMergeStatements } from '../../server/utils/account-merge'
import { parseTrialConfig } from '../../server/utils/trials'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/billing/entitlements', handler: entitlements },
]

const TRIALS = '{"tenant-jrkan":{"entitlement_key":"jrkan.premium","days":90}}'
const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>

const setup = async (env: Record<string, string> = { TENANT_SIGNUP_TRIALS: TRIALS }) => {
  h = await createHarness(ROUTES, env)
  h.db.sqlite.exec(readFileSync(new URL('../../scripts/sql/jrkan-clients.sql', import.meta.url), 'utf8'))
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't1', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');
  `)
  const hash = await hashPassword(PASSWORD, 'pepper')
  for (const [id, email] of [['ga1', 'user@example.com'], ['ga2', 'other@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(id, email, hash)
  }
  // An existing account of another app (think Pastyx) that has never used JRKAN.
  h.db.sqlite.exec(`INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u1', 't1', 'ga1', 'user@example.com')`)
}

beforeEach(() => setup())

const signIn = async (clientId = 'leeguoo-jrkan-ios', email = 'user@example.com') => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: clientId } })
  expect(response.status).toBe(200)
  return (await response.json()) as { access_token: string; refresh_token: string }
}

const listEntitlements = async (accessToken: string) =>
  ((await (await h.request('/api/billing/entitlements', { bearer: accessToken })).json()) as {
    active_entitlement_keys: string[]
    entitlements: Array<Record<string, unknown>>
  })

const trialRows = (gaid = 'ga1') =>
  h.db.sqlite
    .prepare(`SELECT e.valid_from, e.valid_to FROM entitlements e JOIN users u ON u.id = e.user_id WHERE u.global_account_id = ? AND e.source = 'promo'`)
    .all(gaid) as Array<{ valid_from: number; valid_to: number }>

describe('first-use trials', () => {
  it('parses the config and ignores broken entries', () => {
    expect(parseTrialConfig(TRIALS)).toEqual({ 'tenant-jrkan': { entitlement_key: 'jrkan.premium', days: 90 } })
    expect(parseTrialConfig('{"a":{"entitlement_key":"","days":3},"b":{"entitlement_key":"k","days":0}}')).toEqual({})
    expect(parseTrialConfig('not json')).toEqual({})
    expect(parseTrialConfig(undefined)).toEqual({})
  })

  it('the first sign-in grants 90 days, shown by /api/billing/entitlements as a trial', async () => {
    const { access_token: accessToken } = await signIn()
    const body = await listEntitlements(accessToken)
    expect(body.active_entitlement_keys).toEqual(['jrkan.premium'])
    expect(body.entitlements).toHaveLength(1)
    const row = body.entitlements[0]
    expect(row).toMatchObject({ entitlement_key: 'jrkan.premium', source: 'promo', trial: true, status: 'granted', subscription_id: null, plan_key: null })
    expect(Number(row.valid_to) - Number(row.valid_from)).toBe(90 * 86400)
    expect(Math.abs(Number(row.valid_from) - Date.now() / 1000)).toBeLessThan(5)
    expect(row).not.toHaveProperty('meta_json')
  })

  it('signing in again, from another client or by refreshing never extends it', async () => {
    const first = await signIn()
    const [granted] = trialRows()
    await signIn('leeguoo-jrkan-ios')
    await signIn('leeguoo-jrkan-tv')
    const refreshed = await h.request('/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'leeguoo-jrkan-ios' } })
    expect(refreshed.status).toBe(200)
    expect(trialRows()).toEqual([granted])
    // Even after the tenant user is deleted and provisioned again.
    h.db.sqlite.exec(`DELETE FROM entitlements; DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = 'tenant-jrkan'); DELETE FROM sessions; DELETE FROM users WHERE tenant_id = 'tenant-jrkan'`)
    await signIn()
    expect(trialRows()).toEqual([])
  })

  it('tenants without a configured trial get nothing', async () => {
    const { access_token: accessToken } = await signIn('acct-web')
    expect((await listEntitlements(accessToken)).entitlements).toEqual([])
    expect(h.db.sqlite.prepare(`SELECT count(*) AS n FROM entitlements`).get()).toEqual({ n: 0 })
  })

  it('accounts that used JRKAN before the trial existed get it on their next sign-in or refresh', async () => {
    await setup({})
    const before = await signIn()
    expect(trialRows()).toEqual([])
    ;(h.env as Record<string, unknown>).TENANT_SIGNUP_TRIALS = TRIALS
    const refreshed = await h.request('/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: before.refresh_token, client_id: 'leeguoo-jrkan-ios' } })
    expect(refreshed.status).toBe(200)
    expect(trialRows()).toHaveLength(1)
    await signIn()
    expect(trialRows()).toHaveLength(1)
  })

  it('a merge carries the used trial over instead of opening a second one', async () => {
    await signIn('leeguoo-jrkan-ios', 'user@example.com') // ga1 used its trial
    await signIn('acct-web', 'other@example.com') // ga2 never touched JRKAN
    const db = h.db as unknown as D1Database
    const load = (id: string) => h.db.sqlite.prepare(`SELECT id, email, password_hash, password_set, display_name, avatar_url FROM global_accounts WHERE id = ?`).get(id) as never
    const users = (gaid: string) => h.db.sqlite.prepare(`SELECT id, tenant_id FROM users WHERE global_account_id = ?`).all(gaid) as never
    const statements = buildIssuerMergeStatements({
      from: load('ga1'), to: load('ga2'), fromUsers: users('ga1'), toUsers: users('ga2'),
      tables: await listExistingTables(db), mergeId: 'm1', nowSeconds: Math.floor(Date.now() / 1000),
    })
    await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)))

    expect(h.db.sqlite.prepare(`SELECT global_account_id FROM trial_grants`).all()).toEqual([{ global_account_id: 'ga2' }])
    const before = trialRows('ga2')
    expect(before).toHaveLength(1)
    await signIn('leeguoo-jrkan-ios', 'other@example.com')
    expect(trialRows('ga2')).toEqual(before)
  })

  it('a broken grant never blocks the sign-in', async () => {
    h.db.sqlite.exec(`DROP TABLE trial_grants; CREATE TABLE trial_grants (unrelated TEXT)`)
    const { access_token: accessToken } = await signIn()
    expect(accessToken).toBeTruthy()
    expect(trialRows()).toEqual([])
  })
})
