import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import growth from '../../server/routes/api/admin/growth.get'
import { hashPassword } from '../../server/utils/crypto'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/admin/growth', handler: growth },
]

let h: Awaited<ReturnType<typeof createHarness>>
const DAY = 86400

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'app-console' })
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-console', 'App', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't-app', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-admin', 'admin@example.com', ?)`).run(await hashPassword('correct horse battery', 'pepper'))
  const now = Math.floor(Date.now() / 1000)
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email, created_at) VALUES
      ('u-admin', 't-app', 'ga-admin', 'admin@example.com', ${now - 40 * DAY}),
      ('u-a', 't-app', NULL, 'a@example.com', ${now - 3 * DAY}),
      ('u-b', 't-app', NULL, 'b@example.com', ${now}),
      ('u-other', 't-platform', NULL, 'o@example.com', ${now});
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
    INSERT INTO sessions (id, tenant_id, user_id, refresh_token_hash, expires_at, created_at, rotated_at) VALUES
      ('s-a-old', 't-app', 'u-a', 'h1', ${now + DAY}, ${now - 20 * DAY}, ${now - 2 * 3600}),
      ('s-b', 't-app', 'u-b', 'h2', ${now + DAY}, ${now}, NULL),
      ('s-other', 't-platform', 'u-other', 'h3', ${now + DAY}, ${now}, NULL);
  `)
})

describe('admin growth', () => {
  it('counts new and active users of the tenant only, including long-lived refreshed sessions', async () => {
    const token = ((await (await h.request('/api/auth/login', { method: 'POST', json: { email: 'admin@example.com', password: 'correct horse battery', client_id: 'app-console' } })).json()) as { access_token: string }).access_token
    const body = (await (await h.request('/api/admin/growth?tenant_id=t-app&days=7', { bearer: token })).json()) as {
      total_users: number
      active: { dau: number; wau: number; mau: number }
      daily: { day: string; new_users: number; active_users: number }[]
    }
    expect(body.total_users).toBe(3)
    // u-a refreshed 2 h ago, u-b signed in now, the admin just signed in.
    expect(body.active).toEqual({ dau: 3, wau: 3, mau: 3 })
    expect(body.daily).toHaveLength(7)
    expect(body.daily.reduce((sum, d) => sum + d.new_users, 0)).toBe(2)
  })
})
