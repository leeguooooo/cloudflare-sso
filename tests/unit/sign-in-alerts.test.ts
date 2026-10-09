import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import prefsGet from '../../server/routes/api/account/preferences.get'
import prefsPatch from '../../server/routes/api/account/preferences.patch'
import { hashPassword } from '../../server/utils/crypto'
import { capturedEmails } from '../../server/utils/email'
import { describeDevice } from '../../server/utils/sign-in-alerts'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/account/preferences', handler: prefsGet },
  { method: 'patch' as const, path: '/api/account/preferences', handler: prefsPatch },
]

const PASSWORD = 'correct horse battery'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  capturedEmails.length = 0
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', EMAIL_TRANSPORT: 'log' })
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account center', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');
  `)
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-user', 'user@example.com', ?)`).run(await hashPassword(PASSWORD, 'pepper'))
})

const signIn = (ua: string) =>
  h.request('/api/auth/login', { method: 'POST', headers: { 'user-agent': ua }, json: { email: 'user@example.com', password: PASSWORD, client_id: 'acct-web' } })

/** Pretends the earlier sessions are older than the "just created" window. */
const age = () => h.db.sqlite.exec(`UPDATE sessions SET created_at = created_at - 60`)

describe('new-device sign-in alerts', () => {
  it('the first sign-in sends nothing; a known device sends nothing; a new device sends one email', async () => {
    await signIn(MAC)
    expect(capturedEmails).toHaveLength(0)
    age()
    await signIn(MAC)
    expect(capturedEmails).toHaveLength(0)
    age()
    await signIn(IPHONE)
    expect(capturedEmails).toHaveLength(1)
    expect(capturedEmails[0].to).toBe('user@example.com')
    expect(capturedEmails[0].text).toContain('Safari · iPhone')
    expect(capturedEmails[0].text).toContain('Account center')
  })

  it('can be switched off from the account center', async () => {
    const first = await signIn(MAC)
    const token = ((await first.json()) as { access_token: string }).access_token
    expect(((await (await h.request('/api/account/preferences', { bearer: token })).json()) as { sign_in_alerts: boolean }).sign_in_alerts).toBe(true)
    const off = await h.request('/api/account/preferences', { method: 'PATCH', bearer: token, json: { sign_in_alerts: false } })
    expect(((await off.json()) as { sign_in_alerts: boolean }).sign_in_alerts).toBe(false)
    age()
    await signIn(IPHONE)
    expect(capturedEmails).toHaveLength(0)
    expect((await h.request('/api/account/preferences', { method: 'PATCH', bearer: token, json: { sign_in_alerts: 'no' } })).status).toBe(400)
  })

  it('labels common devices', () => {
    expect(describeDevice(MAC)).toBe('Chrome · macOS')
    expect(describeDevice('Paste/3 CFNetwork/1490 Darwin/23.0')).toBe('App')
    expect(describeDevice('')).toContain('Unknown')
  })
})
