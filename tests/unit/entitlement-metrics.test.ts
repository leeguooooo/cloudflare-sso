import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import token from '../../server/routes/token.post'
import check from '../../server/routes/api/billing/entitlements/check.get'
import metrics from '../../server/routes/api/admin/entitlement-metrics.get'
import { hashPassword } from '../../server/utils/crypto'
import { hashClientSecret } from '../../server/utils/client-auth'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'get' as const, path: '/api/billing/entitlements/check', handler: check },
  { method: 'get' as const, path: '/api/admin/entitlement-metrics', handler: metrics },
]

const PASSWORD = 'correct horse battery'
const SECRET = 'service-secret-value'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'app-console' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-console', 'App', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-app-admin', 't-app', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO clients (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope)
    VALUES ('c-svc', 't-app', 'app-backend', ?, 'Backend', '[]', 'client_credentials', 'billing:entitlements.read')`).run(await hashClientSecret(SECRET))
  for (const [ga, email] of [['ga-admin', 'admin@example.com'], ['ga-buyer', 'buyer@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(ga, email, hash)
  }
  const now = Math.floor(Date.now() / 1000)
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES
      ('u-admin', 't-app', 'ga-admin', 'admin@example.com'),
      ('u-buyer', 't-app', 'ga-buyer', 'buyer@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-app-admin');
    INSERT INTO entitlements (id, tenant_id, user_id, entitlement_key, source, valid_from, valid_to, meta_json)
      VALUES ('e1', 't-app', 'u-buyer', 'app.pro', 'promo', ${now - 10}, ${now + 86400}, '{"trial":true}'),
             ('e2', 't-app', 'u-buyer', 'app.old', 'plan', ${now - 100}, ${now - 50}, '{}');
  `)
})

const signIn = async (email: string) => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: 'app-console' } })
  return ((await response.json()) as { access_token: string }).access_token
}

const serviceToken = async () => {
  const basic = Buffer.from(`app-backend:${SECRET}`).toString('base64')
  const response = await h.request('/token', { method: 'POST', headers: { authorization: `Basic ${basic}` }, form: { grant_type: 'client_credentials' } })
  return ((await response.json()) as { access_token: string }).access_token
}

describe('entitlement checks', () => {
  it('answers allowed / denied and counts each answer per app', async () => {
    const buyer = await signIn('buyer@example.com')
    const yes = (await (await h.request('/api/billing/entitlements/check?entitlement_key=app.pro', { bearer: buyer })).json()) as Record<string, unknown>
    expect(yes).toMatchObject({ allowed: true, entitlement_key: 'app.pro', source: 'promo', trial: true })
    const expired = (await (await h.request('/api/billing/entitlements/check?entitlement_key=app.old', { bearer: buyer })).json()) as Record<string, unknown>
    expect(expired.allowed).toBe(false)

    const svc = await serviceToken()
    const viaBackend = await h.request('/api/billing/entitlements/check?entitlement_key=app.pro&user_id=u-buyer', { bearer: svc })
    expect(((await viaBackend.json()) as { allowed: boolean }).allowed).toBe(true)

    const rows = h.db.sqlite.prepare(`SELECT client_id, entitlement_key, result, count FROM entitlement_check_daily ORDER BY client_id, entitlement_key, result`).all()
    expect(rows).toEqual([
      { client_id: 'app-backend', entitlement_key: 'app.pro', result: 'allowed', count: 1 },
      { client_id: 'app-console', entitlement_key: 'app.old', result: 'denied', count: 1 },
      { client_id: 'app-console', entitlement_key: 'app.pro', result: 'allowed', count: 1 },
    ])
  })

  it('needs a key, and a user cannot check someone else', async () => {
    const buyer = await signIn('buyer@example.com')
    expect((await h.request('/api/billing/entitlements/check', { bearer: buyer })).status).toBe(400)
    expect((await h.request('/api/billing/entitlements/check?entitlement_key=app.pro&user_id=u-admin', { bearer: buyer })).status).toBe(403)
  })

  it('tenant admins read allow / deny rates', async () => {
    const buyer = await signIn('buyer@example.com')
    for (const key of ['app.pro', 'app.pro', 'app.old']) {
      await h.request(`/api/billing/entitlements/check?entitlement_key=${key}`, { bearer: buyer })
    }
    expect((await h.request('/api/admin/entitlement-metrics?tenant_id=t-app', { bearer: buyer })).status).toBe(403)

    const admin = await signIn('admin@example.com')
    const body = (await (await h.request('/api/admin/entitlement-metrics?tenant_id=t-app&days=7', { bearer: admin })).json()) as {
      totals: { entitlement_key: string; allowed: number; denied: number; deny_rate: number }[]
      daily: { allowed: number; denied: number }[]
    }
    expect(body.totals).toEqual([
      expect.objectContaining({ entitlement_key: 'app.pro', allowed: 2, denied: 0, deny_rate: 0 }),
      expect.objectContaining({ entitlement_key: 'app.old', allowed: 0, denied: 1, deny_rate: 1 }),
    ])
    expect(body.daily).toEqual([expect.objectContaining({ allowed: 2, denied: 1 })])
  })
})
