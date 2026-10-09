import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import exportUsers, { csvCell } from '../../server/routes/api/admin/users/export.get'
import { hashPassword } from '../../server/utils/crypto'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/admin/users/export', handler: exportUsers },
]

let h: Awaited<ReturnType<typeof createHarness>>

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
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES
      ('u-admin', 't-app', 'ga-admin', 'admin@example.com'),
      ('u-evil', 't-app', NULL, '=HYPERLINK("http://x")@example.com'),
      ('u-other', 't-platform', NULL, 'other@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
  `)
})

describe('users CSV export', () => {
  it('exports the tenant only, with formulas neutralised and the export audited', async () => {
    const token = ((await (await h.request('/api/auth/login', { method: 'POST', json: { email: 'admin@example.com', password: 'correct horse battery', client_id: 'app-console' } })).json()) as { access_token: string }).access_token
    const response = await h.request('/api/admin/users/export?tenant_id=t-app', { bearer: token })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const text = await response.text()
    const lines = text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('user_id,email,status,roles,created_at,last_active_at,global_account_id')
    expect(lines).toHaveLength(3)
    expect(text).not.toContain('other@example.com')
    expect(text).toContain(`"'=HYPERLINK(""http://x"")@example.com"`)
    expect(text).toMatch(/"u-admin","admin@example.com","active","admin user"|"u-admin","admin@example.com","active","user admin"/)
    expect(h.db.sqlite.prepare(`SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.users.export'`).get()).toEqual({ n: 1 })
    expect((await h.request('/api/admin/users/export?tenant_id=t-platform', { bearer: token })).status).toBe(403)
  })

  it('quotes cells', () => {
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('+1')).toBe(`"'+1"`)
    expect(csvCell(null)).toBe('""')
  })
})
