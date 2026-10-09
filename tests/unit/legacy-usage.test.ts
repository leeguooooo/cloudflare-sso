import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import token from '../../server/routes/token.post'
import report from '../../server/routes/api/metrics/legacy-auth.post'
import dashboard from '../../server/routes/api/admin/legacy-auth.get'
import { hashPassword } from '../../server/utils/crypto'
import { hashClientSecret } from '../../server/utils/client-auth'
import { readyToCut } from '../../server/utils/legacy-usage'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'post' as const, path: '/api/metrics/legacy-auth', handler: report },
  { method: 'get' as const, path: '/api/admin/legacy-auth', handler: dashboard },
]

const SECRET = 'service-secret-value'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'paste-console' })
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-paste', 'Paste');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-paste', 't-paste', 'paste-console', 'Paste', '["https://paste.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't-paste', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO clients (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope)
    VALUES ('c-svc', 't-paste', 'paste-backend', ?, 'Backend', '[]', 'client_credentials', 'metrics:legacy.write')`).run(await hashClientSecret(SECRET))
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-admin', 'admin@example.com', ?)`).run(await hashPassword('correct horse battery', 'pepper'))
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u-admin', 't-paste', 'ga-admin', 'admin@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
  `)
})

const serviceToken = async () => {
  const basic = Buffer.from(`paste-backend:${SECRET}`).toString('base64')
  const response = await h.request('/token', { method: 'POST', headers: { authorization: `Basic ${basic}` }, form: { grant_type: 'client_credentials' } })
  return ((await response.json()) as { access_token: string }).access_token
}

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)

describe('legacy auth usage', () => {
  it('adds up reports per day and shows the fallback rate to tenant admins', async () => {
    const svc = await serviceToken()
    for (const hits of [3, 2]) {
      const response = await h.request('/api/metrics/legacy-auth', {
        method: 'POST',
        bearer: svc,
        json: { tenant_id: 't-paste', reports: [{ client_id: 'paste-macos', path: 'header-identity', legacy_hits: hits, total_requests: 1000 }] },
      })
      expect(response.status).toBe(200)
    }
    const bad = await h.request('/api/metrics/legacy-auth', {
      method: 'POST',
      bearer: svc,
      json: { tenant_id: 't-paste', reports: [{ client_id: 'paste-macos', path: 'x', legacy_hits: 5, total_requests: 1 }] },
    })
    expect(bad.status).toBe(400)

    const loginResponse = await h.request('/api/auth/login', { method: 'POST', json: { email: 'admin@example.com', password: 'correct horse battery', client_id: 'paste-console' } })
    const admin = ((await loginResponse.json()) as { access_token: string }).access_token
    const body = (await (await h.request('/api/admin/legacy-auth?tenant_id=t-paste', { bearer: admin })).json()) as {
      paths: { client_id: string; path: string; legacy_hits: number; total_requests: number; rate: number; ready_to_cut: boolean }[]
    }
    expect(body.paths).toEqual([
      expect.objectContaining({ client_id: 'paste-macos', path: 'header-identity', legacy_hits: 5, total_requests: 2000, rate: 0.0025, ready_to_cut: false }),
    ])
  })

  it('is ready to cut only after 7 consecutive reported days under 0.1%', () => {
    const today = day(0)
    const quiet = Array.from({ length: 7 }, (_, i) => ({ day: day(i), legacy_hits: 0, total_requests: 500 }))
    expect(readyToCut(quiet, today)).toBe(true)
    expect(readyToCut(quiet.slice(0, 6), today)).toBe(false)
    const gap = quiet.map((d, i) => (i === 3 ? { ...d, day: day(9) } : d))
    expect(readyToCut(gap, today)).toBe(false)
    const spike = quiet.map((d, i) => (i === 5 ? { ...d, legacy_hits: 1 } : d))
    expect(readyToCut(spike, today)).toBe(false)
  })
})
