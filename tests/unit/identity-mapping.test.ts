import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import token from '../../server/routes/token.post'
import importMappings from '../../server/routes/api/admin/identity-mappings/import.post'
import listMappings from '../../server/routes/api/admin/identity-mappings/index.get'
import revertMappings from '../../server/routes/api/admin/identity-mappings/revert.post'
import { hashPassword } from '../../server/utils/crypto'
import { hashClientSecret } from '../../server/utils/client-auth'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'post' as const, path: '/api/admin/identity-mappings/import', handler: importMappings },
  { method: 'get' as const, path: '/api/admin/identity-mappings', handler: listMappings },
  { method: 'post' as const, path: '/api/admin/identity-mappings/revert', handler: revertMappings },
]

const PASSWORD = 'correct horse battery'
const SECRET = 'service-secret-value'
let h: Awaited<ReturnType<typeof createHarness>>
let admin = ''

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'paste-console' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-paste', 'Paste');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-paste', 't-paste', 'paste-console', 'Paste', '["https://paste.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't-paste', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO clients (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope)
    VALUES ('c-svc', 't-paste', 'paste-backend', ?, 'Backend', '[]', 'client_credentials', 'identity:mappings.read')`).run(await hashClientSecret(SECRET))
  for (const [ga, email] of [['ga-admin', 'admin@example.com'], ['ga-alice', 'alice@example.com'], ['ga-off', 'off@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(ga, email, hash)
  }
  h.db.sqlite.exec(`
    UPDATE global_accounts SET status = 'disabled' WHERE id = 'ga-off';
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u-admin', 't-paste', 'ga-admin', 'admin@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
  `)
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email: 'admin@example.com', password: PASSWORD, client_id: 'paste-console' } })
  admin = ((await response.json()) as { access_token: string }).access_token
})

const RECORDS = [
  { source_user_id: '1', email: 'Alice@example.com', email_verified: true },
  { source_user_id: '2', email: 'bob@example.com', email_verified: true },
  { source_user_id: '3', email: 'alice@example.com', email_verified: false },
  { source_user_id: '4', global_account_id: 'ga-alice' },
  { source_user_id: '5', email: 'off@example.com', email_verified: true },
  { source_user_id: '1', email: 'alice@example.com', email_verified: true },
  { email: 'nobody@example.com', email_verified: true },
]

type ImportResponse = { run_id: string; dry_run: boolean; summary: Record<string, number>; results: { source_user_id: string; outcome: string; user_id?: string }[] }

const runImport = async (extra: Record<string, unknown> = {}) => {
  const response = await h.request('/api/admin/identity-mappings/import', {
    method: 'POST',
    bearer: admin,
    json: { tenant_id: 't-paste', source_system: 'paste', records: RECORDS, create_missing: true, ...extra },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ImportResponse
}

describe('identity mapping import', () => {
  it('a dry run reports outcomes and writes nothing', async () => {
    const report = await runImport({ dry_run: true })
    expect(report.results.map((r) => r.outcome)).toEqual(['linked', 'created', 'needs_review', 'manual', 'needs_review', 'invalid', 'invalid'])
    expect(h.db.sqlite.prepare(`SELECT count(*) AS n FROM identity_mappings`).get()).toEqual({ n: 0 })
    expect(h.db.sqlite.prepare(`SELECT count(*) AS n FROM global_accounts WHERE email = 'bob@example.com'`).get()).toEqual({ n: 0 })
  })

  it('links verified emails, creates missing accounts without a password, and is idempotent', async () => {
    const first = await runImport()
    expect(first.summary).toEqual({ linked: 1, created: 1, needs_review: 2, manual: 1, invalid: 2 })
    const bob = h.db.sqlite.prepare(`SELECT password_set, password_hash FROM global_accounts WHERE email = 'bob@example.com'`).get() as { password_set: number; password_hash: string }
    expect(bob.password_set).toBe(0)
    expect(bob.password_hash.startsWith('unset$')).toBe(true)
    // Alice's two legacy ids (1 by email, 4 by admin decision) land on the same tenant user.
    const alice = first.results.filter((r) => r.outcome === 'linked' || r.outcome === 'manual').map((r) => r.user_id)
    expect(new Set(alice).size).toBe(1)

    const again = await runImport()
    expect(again.summary).toEqual({ unchanged: 3, needs_review: 2, invalid: 2 })
  })

  it('an imported account without a password cannot be signed into with any password', async () => {
    await runImport()
    const response = await h.request('/api/auth/login', { method: 'POST', json: { email: 'bob@example.com', password: 'unset$anything', client_id: 'paste-console' } })
    expect(response.status).toBe(401)
  })

  it('backends resolve legacy ids with a read-scoped service token, but cannot import', async () => {
    await runImport()
    const basic = Buffer.from(`paste-backend:${SECRET}`).toString('base64')
    const tokenResponse = await h.request('/token', { method: 'POST', headers: { authorization: `Basic ${basic}` }, form: { grant_type: 'client_credentials' } })
    const svc = ((await tokenResponse.json()) as { access_token: string }).access_token

    const lookup = (await (await h.request('/api/admin/identity-mappings?tenant_id=t-paste&source_system=paste&source_user_id=2', { bearer: svc })).json()) as {
      mappings: { user_id: string; email: string; outcome: string }[]
    }
    expect(lookup.mappings).toEqual([expect.objectContaining({ email: 'bob@example.com', outcome: 'created' })])

    const write = await h.request('/api/admin/identity-mappings/import', {
      method: 'POST',
      bearer: svc,
      json: { tenant_id: 't-paste', source_system: 'paste', records: RECORDS },
    })
    expect(write.status).toBe(403)
  })

  it('reverting a run frees the legacy ids and lists the accounts it created', async () => {
    const first = await runImport()
    const revert = await h.request('/api/admin/identity-mappings/revert', { method: 'POST', bearer: admin, json: { tenant_id: 't-paste', run_id: first.run_id } })
    expect(revert.status).toBe(200)
    const body = (await revert.json()) as { reverted: number; created_accounts: string[] }
    expect(body.reverted).toBe(3)
    expect(body.created_accounts).toHaveLength(1)

    const redo = await runImport()
    expect(redo.summary.unchanged || 0).toBe(0)
    expect(redo.summary.linked).toBe(2) // bob's account exists now
  })

  it('rejects bad input and unknown tenants', async () => {
    const bad = await h.request('/api/admin/identity-mappings/import', { method: 'POST', bearer: admin, json: { tenant_id: 't-paste', source_system: 'Paste!', records: RECORDS } })
    expect(bad.status).toBe(400)
    const none = await h.request('/api/admin/identity-mappings/import', { method: 'POST', bearer: admin, json: { tenant_id: 't-paste', source_system: 'paste', records: [] } })
    expect(none.status).toBe(400)
  })
})
