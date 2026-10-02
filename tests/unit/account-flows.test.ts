import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import forgot from '../../server/routes/api/auth/password/forgot.post'
import reset from '../../server/routes/api/auth/password/reset.post'
import emailVerifyLanding from '../../server/routes/api/auth/email/verify.get'
import sendVerify from '../../server/routes/api/account/email/verify.post'
import changeEmail from '../../server/routes/api/account/email/change.post'
import center from '../../server/routes/api/account/center.get'
import exportAccount from '../../server/routes/api/account/export.get'
import providers from '../../server/routes/api/auth/providers.get'
import miniprogram from '../../server/routes/api/auth/wechat/miniprogram.post'
import usersList from '../../server/routes/api/admin/users.get'
import usersManage from '../../server/routes/api/admin/users.post'
import metrics from '../../server/routes/api/admin/metrics.get'
import reconcile from '../../server/routes/api/internal/billing/reconcile.post'
import { hashPassword } from '../../server/utils/crypto'
import { hashAccountPassword, verifyAccountPassword } from '../../server/utils/password'
import { capturedEmails } from '../../server/utils/email'
import { ensureBillingSchema } from '../../server/utils/billing'
import { createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/api/auth/password/forgot', handler: forgot },
  { method: 'post' as const, path: '/api/auth/password/reset', handler: reset },
  { method: 'get' as const, path: '/api/auth/email/verify', handler: emailVerifyLanding },
  { method: 'post' as const, path: '/api/account/email/verify', handler: sendVerify },
  { method: 'post' as const, path: '/api/account/email/change', handler: changeEmail },
  { method: 'get' as const, path: '/api/account/center', handler: center },
  { method: 'get' as const, path: '/api/account/export', handler: exportAccount },
  { method: 'get' as const, path: '/api/auth/providers', handler: providers },
  { method: 'post' as const, path: '/api/auth/wechat/miniprogram', handler: miniprogram },
  { method: 'get' as const, path: '/api/admin/users', handler: usersList },
  { method: 'post' as const, path: '/api/admin/users', handler: usersManage },
  { method: 'get' as const, path: '/api/admin/metrics', handler: metrics },
  { method: 'post' as const, path: '/api/internal/billing/reconcile', handler: reconcile },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>

const setup = async (env: Record<string, string> = {}) => {
  h = await createHarness(ROUTES, {
    EMAIL_TRANSPORT: 'log',
    PASSWORD_PEPPER_V2: 'new-secret-pepper',
    RECONCILE_SECRET: 'reconcile-secret',
    WECHAT_MINIPROGRAMS: '{"mp-client":{"appid":"wxapp1"}}',
    WECHAT_MP_SECRET_WXAPP1: 'mp-secret',
    ...env,
  })
  // Legacy hash under the old (public) pepper, like every account created before the migration.
  const legacy = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't1', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-mp', 't1', 'mp-client', 'Mini program', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't1', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga1', 'user@example.com', ?)`).run(legacy)
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-admin', 'admin@example.com', ?)`).run(legacy)
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u1', 't1', 'ga1', 'user@example.com'), ('u-admin', 't1', 'ga-admin', 'admin@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
  `)
  capturedEmails.length = 0
}

const signIn = async (email = 'user@example.com', password = PASSWORD) => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password, client_id: 'acct-web' } })
  return { status: response.status, token: response.status === 200 ? ((await response.json()) as { access_token: string }).access_token : '' }
}

const linkFrom = (index = -1) => {
  const mail = capturedEmails.at(index)
  const match = mail?.text.match(/https:\/\/sso\.test\S+/)
  return new URL(match?.[0] || 'https://invalid')
}

beforeEach(() => setup())
afterEach(() => vi.unstubAllGlobals())

describe('password pepper migration', () => {
  it('legacy hashes verify and get upgraded to the v2 pepper on sign-in', async () => {
    expect((await signIn()).status).toBe(200)
    const row = h.db.sqlite.prepare(`SELECT password_hash FROM global_accounts WHERE id = 'ga1'`).get() as { password_hash: string }
    expect(row.password_hash.startsWith('pbkdf2v2$')).toBe(true)
    expect((await signIn()).status).toBe(200)
  })

  it('a v2 hash is useless without the v2 pepper', async () => {
    const env = { PASSWORD_PEPPER: 'pepper', PASSWORD_PEPPER_V2: 'v2' }
    const hash = await hashAccountPassword(env, 'secret-pass')
    expect((await verifyAccountPassword(env, 'secret-pass', hash)).ok).toBe(true)
    expect((await verifyAccountPassword({ PASSWORD_PEPPER: 'pepper' }, 'secret-pass', hash)).ok).toBe(false)
  })
})

describe('forgot / reset password', () => {
  it('mails a link that sets a new password once and signs out every session', async () => {
    const before = await signIn()
    expect((await h.request('/api/auth/password/forgot', { method: 'POST', json: { email: 'USER@example.com' } })).status).toBe(200)
    const link = linkFrom()
    expect(link.pathname).toBe('/reset-password')
    const token = link.searchParams.get('token') || ''

    const done = await h.request('/api/auth/password/reset', { method: 'POST', json: { token, password: 'brand new password' } })
    expect(await done.json()).toMatchObject({ ok: true, email: 'user@example.com' })
    expect((await signIn()).status).toBe(401)
    expect((await signIn('user@example.com', 'brand new password')).status).toBe(200)
    // The old session is gone and the email counts as verified now.
    expect((await h.request('/api/account/center', { bearer: before.token })).status).toBe(401)

    const again = await h.request('/api/auth/password/reset', { method: 'POST', json: { token, password: 'another password' } })
    expect(again.status).toBe(400)
  })

  it('does not reveal whether an account exists', async () => {
    const response = await h.request('/api/auth/password/forgot', { method: 'POST', json: { email: 'nobody@example.com' } })
    expect(await response.json()).toEqual({ ok: true })
    expect(capturedEmails).toHaveLength(0)
  })

  it('is off, and advertised as off, without an email transport', async () => {
    await setup({ EMAIL_TRANSPORT: '' })
    const flags = (await (await h.request('/api/auth/providers?client_id=acct-web')).json()) as Record<string, unknown>
    expect(flags.password_reset).toBe(false)
    expect((await h.request('/api/auth/password/forgot', { method: 'POST', json: { email: 'user@example.com' } })).status).toBe(503)
  })
})

describe('email verification and change', () => {
  it('verifies the current email through the mailed link', async () => {
    const { token } = await signIn()
    const before = (await (await h.request('/api/account/center', { bearer: token })).json()) as { profile: { email_verified: boolean }; email_enabled: boolean }
    expect(before).toMatchObject({ email_enabled: true, profile: { email_verified: false } })

    expect((await h.request('/api/account/email/verify', { method: 'POST', bearer: token })).status).toBe(200)
    const landing = await h.request(`${linkFrom().pathname}${linkFrom().search}`)
    expect(landing.headers.get('location')).toContain('email_verified=1')
    const after = (await (await h.request('/api/account/center', { bearer: token })).json()) as { profile: { email_verified: boolean } }
    expect(after.profile.email_verified).toBe(true)
  })

  it('changes the email only after the new address confirms, and refuses taken addresses', async () => {
    const { token } = await signIn()
    expect((await h.request('/api/account/email/change', { method: 'POST', bearer: token, json: { new_email: 'admin@example.com' } })).status).toBe(409)

    const sent = await h.request('/api/account/email/change', { method: 'POST', bearer: token, json: { new_email: 'New@Example.com' } })
    expect(await sent.json()).toMatchObject({ ok: true, sent_to: 'new@example.com' })
    expect(capturedEmails.at(-1)?.to).toBe('new@example.com')
    const stillOld = h.db.sqlite.prepare(`SELECT email FROM global_accounts WHERE id = 'ga1'`).get() as { email: string }
    expect(stillOld.email).toBe('user@example.com')

    const landing = await h.request(`${linkFrom().pathname}${linkFrom().search}`)
    expect(landing.headers.get('location')).toContain('email_changed=1')
    expect((await signIn('new@example.com')).status).toBe(200)
  })

  it('a stale session cannot change the email', async () => {
    const { token } = await signIn()
    h.db.sqlite.exec(`UPDATE sessions SET auth_time = auth_time - 7200, created_at = created_at - 7200`)
    const response = await h.request('/api/account/email/change', { method: 'POST', bearer: token, json: { new_email: 'x@example.com' } })
    expect(response.status).toBe(403)
  })
})

describe('account export', () => {
  it('downloads the account as JSON', async () => {
    const { token } = await signIn()
    const response = await h.request('/api/account/export', { bearer: token })
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="leeguoo-account-/)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('account')
    expect(Array.isArray(body.activity)).toBe(true)
  })
})

describe('WeChat mini-program sign-in', () => {
  const stubWechat = (payload: Record<string, unknown>) =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/sns/jscode2session')
      expect(url.searchParams.get('appid')).toBe('wxapp1')
      expect(url.searchParams.get('secret')).toBe('mp-secret')
      return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
    })

  it('creates one account per unionid and returns SSO tokens', async () => {
    stubWechat({ openid: 'o-1', session_key: 'k', unionid: 'union-1' })
    const first = await h.request('/api/auth/wechat/miniprogram', { method: 'POST', json: { client_id: 'mp-client', code: 'c1' } })
    expect(first.status).toBe(200)
    const tokens = (await first.json()) as Record<string, string>
    expect(tokens.access_token && tokens.refresh_token).toBeTruthy()

    const second = await h.request('/api/auth/wechat/miniprogram', { method: 'POST', json: { client_id: 'mp-client', code: 'c2' } })
    expect(second.status).toBe(200)
    const accounts = h.db.sqlite.prepare(`SELECT count(*) AS n FROM global_external_identities WHERE provider = 'wechat' AND subject = 'union-1'`).get() as { n: number }
    expect(accounts.n).toBe(1)
    const email = h.db.sqlite.prepare(`SELECT ga.email FROM global_accounts ga JOIN global_external_identities g ON g.global_account_id = ga.id WHERE g.subject = 'union-1'`).get() as { email: string }
    expect(email.email).toMatch(/^wechat-[0-9a-f]+@users\.account\.invalid$/)
  })

  it('passes WeChat errors through as 502', async () => {
    stubWechat({ errcode: 40029, errmsg: 'invalid code' })
    const response = await h.request('/api/auth/wechat/miniprogram', { method: 'POST', json: { client_id: 'mp-client', code: 'bad' } })
    expect(response.status).toBe(502)
  })

  it('refuses clients without a mini-program mapping', async () => {
    const response = await h.request('/api/auth/wechat/miniprogram', { method: 'POST', json: { client_id: 'acct-web', code: 'c' } })
    expect(response.status).toBe(400)
  })
})

describe('admin users and metrics', () => {
  it('lists users and disabling one cuts their access immediately', async () => {
    const admin = (await signIn('admin@example.com')).token
    const user = (await signIn()).token
    const list = (await (await h.request('/api/admin/users?tenant_id=t1&q=user@', { bearer: admin })).json()) as { users: Array<{ id: string; active_sessions: number }> }
    expect(list.users.map((u) => u.id)).toEqual(['u1'])
    expect(list.users[0].active_sessions).toBe(1)

    const disabled = await h.request('/api/admin/users', { method: 'POST', bearer: admin, json: { tenant_id: 't1', action: 'disable', user_id: 'u1' } })
    expect(disabled.status).toBe(200)
    expect((await h.request('/api/account/center', { bearer: user })).status).toBe(401)
    expect((await signIn()).status).toBe(403)

    const self = await h.request('/api/admin/users', { method: 'POST', bearer: admin, json: { tenant_id: 't1', action: 'disable', user_id: 'u-admin' } })
    expect(self.status).toBe(400)
  })

  it('counts sign-ins and failures from the audit log', async () => {
    await signIn()
    await signIn('user@example.com', 'wrong password')
    const admin = (await signIn('admin@example.com')).token
    const body = (await (await h.request('/api/admin/metrics?tenant_id=t1&days=7', { bearer: admin })).json()) as {
      totals: Record<string, number>
      daily: Array<Record<string, number | string>>
    }
    expect(body.totals.login_success).toBe(2)
    expect(body.totals.login_failure).toBe(1)
    expect(body.daily).toHaveLength(7)
  })
})

describe('billing reconciliation', () => {
  it('needs the shared secret', async () => {
    expect((await h.request('/api/internal/billing/reconcile', { method: 'POST' })).status).toBe(401)
    expect((await h.request('/api/internal/billing/reconcile', { method: 'POST', bearer: 'nope' })).status).toBe(401)
  })

  it('expires lapsed cancel-at-period-end subscriptions and repairs drifted entitlements', async () => {
    const now = Math.floor(Date.now() / 1000)
    await ensureBillingSchema({ context: { cloudflare: { env: h.env } } } as never)
    h.db.sqlite.exec(`
      INSERT INTO products (id, tenant_id, product_key, name, app_key) VALUES ('p1', 't1', 'pro', 'Pro', 'app');
      INSERT INTO plans (id, tenant_id, product_id, plan_key, name, billing_cycle, entitlement_keys_json)
        VALUES ('pl1', 't1', 'p1', 'pro', 'Pro', 'monthly', '["app.pro"]');
      INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, status, started_at, current_period_end, cancel_at_period_end)
        VALUES ('s-lapsed', 't1', 'u1', 'pl1', 'active', ${now - 40 * 86400}, ${now - 10 * 86400}, 1),
               ('s-live', 't1', 'u-admin', 'pl1', 'active', ${now - 5 * 86400}, ${now + 25 * 86400}, 0);
      INSERT INTO entitlements (id, tenant_id, user_id, subscription_id, entitlement_key, source, status, valid_from, valid_to)
        VALUES ('e-lapsed', 't1', 'u1', 's-lapsed', 'app.pro', 'plan', 'granted', ${now - 40 * 86400}, NULL);
    `)
    const response = await h.request('/api/internal/billing/reconcile', { method: 'POST', bearer: 'reconcile-secret' })
    expect(response.status).toBe(200)
    const report = (await response.json()) as { expired_subscriptions: string[]; repaired_entitlements: string[] }
    expect(report.expired_subscriptions).toEqual(['s-lapsed'])
    expect(report.repaired_entitlements).toContain('s-live')

    const lapsed = h.db.sqlite.prepare(`SELECT valid_to FROM entitlements WHERE id = 'e-lapsed'`).get() as { valid_to: number }
    expect(lapsed.valid_to).toBe(now - 10 * 86400)
    const live = h.db.sqlite.prepare(`SELECT valid_to, status FROM entitlements WHERE subscription_id = 's-live'`).get() as { valid_to: number; status: string }
    expect(live).toEqual({ valid_to: now + 25 * 86400, status: 'granted' })

    // A second run finds nothing left to do.
    const again = (await (await h.request('/api/internal/billing/reconcile', { method: 'POST', bearer: 'reconcile-secret' })).json()) as {
      expired_subscriptions: string[]
      repaired_entitlements: string[]
    }
    expect(again.expired_subscriptions).toEqual([])
    expect(again.repaired_entitlements).toEqual([])
  })
})
