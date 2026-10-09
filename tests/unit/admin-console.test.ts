import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import tenants from '../../server/routes/api/admin/tenants.get'
import audit from '../../server/routes/api/admin/audit.get'
import accounts from '../../server/routes/api/admin/accounts/index.get'
import accountDetail from '../../server/routes/api/admin/accounts/[id].get'
import accountAction from '../../server/routes/api/admin/accounts/[id].post'
import adminUsers from '../../server/routes/api/admin/users.get'
import { hashPassword } from '../../server/utils/crypto'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/admin/tenants', handler: tenants },
  { method: 'get' as const, path: '/api/admin/audit', handler: audit },
  { method: 'get' as const, path: '/api/admin/accounts', handler: accounts },
  { method: 'get' as const, path: '/api/admin/accounts/:id', handler: accountDetail },
  { method: 'post' as const, path: '/api/admin/accounts/:id', handler: accountAction },
  { method: 'get' as const, path: '/api/admin/users', handler: adminUsers },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'app-console' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-console', 'App console', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-platform-admin', 't-platform', 'admin'), ('r-app-admin', 't-app', 'admin');
  `)
  for (const [ga, email] of [['ga-root', 'root@example.com'], ['ga-appadmin', 'appadmin@example.com'], ['ga-buyer', 'buyer@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(ga, email, hash)
  }
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES
      ('u-root', 't-platform', 'ga-root', 'root@example.com'),
      ('u-appadmin', 't-app', 'ga-appadmin', 'appadmin@example.com'),
      ('u-buyer', 't-app', 'ga-buyer', 'buyer@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-root', 'r-platform-admin'), ('ur2', 'u-appadmin', 'r-app-admin');
    INSERT INTO global_external_identities (id, global_account_id, provider, subject, email, refresh_token)
      VALUES ('gi1', 'ga-buyer', 'apple', 'apple-sub', 'buyer@example.com', 'provider-secret');
  `)
})

const signIn = async (email: string, clientId: string) => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: clientId } })
  expect(response.status).toBe(200)
  return ((await response.json()) as { access_token: string }).access_token
}

describe('admin tenants', () => {
  it('platform admins see every tenant, tenant admins only their own', async () => {
    const root = await signIn('root@example.com', 'acct-web')
    const all = (await (await h.request('/api/admin/tenants', { bearer: root })).json()) as { platform: boolean; tenants: { id: string; users: number }[] }
    expect(all.platform).toBe(true)
    expect(all.tenants.map((t) => t.id).sort()).toEqual(['t-app', 't-platform'])
    expect(all.tenants.find((t) => t.id === 't-app')?.users).toBe(2)

    const appAdmin = await signIn('appadmin@example.com', 'app-console')
    const own = (await (await h.request('/api/admin/tenants', { bearer: appAdmin })).json()) as { platform: boolean; tenants: { id: string }[] }
    expect(own.platform).toBe(false)
    expect(own.tenants.map((t) => t.id)).toEqual(['t-app'])
  })

  it('platform admins administer any tenant; tenant admins stay in their own', async () => {
    const root = await signIn('root@example.com', 'acct-web')
    const users = (await (await h.request('/api/admin/users?tenant_id=t-app', { bearer: root })).json()) as { users: { email: string }[] }
    expect(users.users.map((u) => u.email).sort()).toEqual(['appadmin@example.com', 'buyer@example.com'])

    const appAdmin = await signIn('appadmin@example.com', 'app-console')
    expect((await h.request('/api/admin/users?tenant_id=t-platform', { bearer: appAdmin })).status).toBe(403)
  })

  it('refuses non-admins', async () => {
    h.db.sqlite.exec(`INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u-buyer-p', 't-platform', 'ga-buyer', 'buyer@example.com')`)
    const buyer = await signIn('buyer@example.com', 'acct-web')
    expect((await h.request('/api/admin/tenants', { bearer: buyer })).status).toBe(403)
  })
})

describe('admin global accounts', () => {
  it('only platform admins can list accounts', async () => {
    const appAdmin = await signIn('appadmin@example.com', 'app-console')
    expect((await h.request('/api/admin/accounts', { bearer: appAdmin })).status).toBe(403)

    const root = await signIn('root@example.com', 'acct-web')
    const body = (await (await h.request('/api/admin/accounts?q=buyer', { bearer: root })).json()) as { accounts: { id: string; tenants: string[]; providers: string[] }[] }
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0]).toMatchObject({ id: 'ga-buyer', tenants: ['t-app'], providers: ['apple'] })
  })

  it('detail covers tenants, identities and sessions without leaking secrets', async () => {
    await signIn('buyer@example.com', 'app-console')
    const root = await signIn('root@example.com', 'acct-web')
    const response = await h.request('/api/admin/accounts/ga-buyer', { bearer: root })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('provider-secret')
    expect(text).not.toContain('password_hash')
    const body = JSON.parse(text) as { users: { tenant_id: string }[]; identities: { provider: string }[]; sessions: { active: boolean }[] }
    expect(body.users.map((u) => u.tenant_id)).toEqual(['t-app'])
    expect(body.identities.map((i) => i.provider)).toEqual(['apple'])
    expect(body.sessions.some((s) => s.active)).toBe(true)

    expect((await h.request('/api/admin/accounts/nope', { bearer: root })).status).toBe(404)
  })

  it('suspending signs the account out and blocks sign-in until restored', async () => {
    await signIn('buyer@example.com', 'app-console')
    const root = await signIn('root@example.com', 'acct-web')
    const suspend = await h.request('/api/admin/accounts/ga-buyer', { method: 'POST', bearer: root, json: { action: 'suspend' } })
    expect(suspend.status).toBe(200)
    const live = h.db.sqlite.prepare(`SELECT count(*) AS n FROM sessions WHERE user_id = 'u-buyer' AND revoked_at IS NULL`).get() as { n: number }
    expect(live.n).toBe(0)
    const blocked = await h.request('/api/auth/login', { method: 'POST', json: { email: 'buyer@example.com', password: PASSWORD, client_id: 'app-console' } })
    expect(blocked.status).toBeGreaterThanOrEqual(400)

    await h.request('/api/admin/accounts/ga-buyer', { method: 'POST', bearer: root, json: { action: 'restore' } })
    await signIn('buyer@example.com', 'app-console')
  })

  it('a platform admin cannot suspend themselves', async () => {
    const root = await signIn('root@example.com', 'acct-web')
    const response = await h.request('/api/admin/accounts/ga-root', { method: 'POST', bearer: root, json: { action: 'suspend' } })
    expect(response.status).toBe(400)
  })

  it('grants and revokes a manual entitlement through the billing event log', async () => {
    const root = await signIn('root@example.com', 'acct-web')
    const validTo = Math.floor(Date.now() / 1000) + 86400
    const grant = await h.request('/api/admin/accounts/ga-buyer', {
      method: 'POST',
      bearer: root,
      json: { action: 'grant_entitlement', tenant_id: 't-app', entitlement_key: 'app.pro', valid_to: validTo, note: 'support' },
    })
    expect(grant.status).toBe(200)
    const detail = (await (await h.request('/api/admin/accounts/ga-buyer', { bearer: root })).json()) as { entitlements: { entitlement_key: string; source: string; active: boolean }[] }
    expect(detail.entitlements).toEqual([expect.objectContaining({ entitlement_key: 'app.pro', source: 'manual', active: true })])
    const events = h.db.sqlite.prepare(`SELECT provider, event_type, status FROM subscription_events`).all()
    expect(events).toEqual([{ provider: 'manual', event_type: 'entitlement.granted', status: 'applied' }])

    const revoke = await h.request('/api/admin/accounts/ga-buyer', { method: 'POST', bearer: root, json: { action: 'revoke_entitlement', tenant_id: 't-app', entitlement_key: 'app.pro' } })
    expect(revoke.status).toBe(200)
    const after = h.db.sqlite.prepare(`SELECT status FROM entitlements WHERE user_id = 'u-buyer'`).get() as { status: string }
    expect(after.status).toBe('revoked')

    const past = await h.request('/api/admin/accounts/ga-buyer', { method: 'POST', bearer: root, json: { action: 'grant_entitlement', tenant_id: 't-app', entitlement_key: 'app.pro', valid_to: 1 } })
    expect(past.status).toBe(400)
  })
})

describe('admin audit log', () => {
  it('pages newest first and keeps tenant admins inside their tenant', async () => {
    for (let i = 0; i < 5; i++) {
      h.db.sqlite
        .prepare(`INSERT INTO audit_logs (id, tenant_id, user_id, action, payload_json, created_at) VALUES (?, 't-app', 'u-buyer', ?, '{"n":1}', 1000)`)
        .run(`a${i}`, i % 2 ? 'auth.login' : 'admin.user.disable')
    }
    const appAdmin = await signIn('appadmin@example.com', 'app-console')
    const first = (await (await h.request('/api/admin/audit?limit=2&action=admin.', { bearer: appAdmin })).json()) as { entries: { id: string; payload: unknown }[]; next_before: string }
    expect(first.entries.map((e) => e.id)).toEqual(['a4', 'a2'])
    expect(first.entries[0].payload).toEqual({ n: 1 })
    const second = (await (await h.request(`/api/admin/audit?limit=2&action=admin.&before=${encodeURIComponent(first.next_before)}`, { bearer: appAdmin })).json()) as { entries: { id: string }[] }
    expect(second.entries.map((e) => e.id)).toEqual(['a0'])

    expect((await h.request('/api/admin/audit?tenant_id=t-platform', { bearer: appAdmin })).status).toBe(403)
    expect((await h.request('/api/admin/audit?account=ga-buyer', { bearer: appAdmin })).status).toBe(403)

    const root = await signIn('root@example.com', 'acct-web')
    const byAccount = (await (await h.request('/api/admin/audit?account=ga-buyer&limit=10', { bearer: root })).json()) as { entries: { user_id: string }[] }
    expect(byAccount.entries).toHaveLength(5)
    expect(byAccount.entries.every((e) => e.user_id === 'u-buyer')).toBe(true)
  })
})
