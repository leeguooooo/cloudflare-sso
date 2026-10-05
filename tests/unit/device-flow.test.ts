import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import authorize from '../../server/routes/authorize.get'
import token from '../../server/routes/token.post'
import login from '../../server/routes/api/auth/login.post'
import deviceCode from '../../server/routes/device/code.post'
import lookup from '../../server/routes/api/auth/device/lookup.get'
import verify from '../../server/routes/api/auth/device/verify.post'
import openidConfiguration from '../../server/routes/.well-known/openid-configuration.get'
import { hashPassword } from '../../server/utils/crypto'
import { DEVICE_CODE_GRANT, generateUserCode, normalizeUserCode } from '../../server/utils/device'
import { cookieFrom, createHarness, decodeJwt, ISSUER, pkcePair } from '../helpers/harness'

const ROUTES = [
  { method: 'get' as const, path: '/authorize', handler: authorize },
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/device/code', handler: deviceCode },
  { method: 'get' as const, path: '/api/auth/device/lookup', handler: lookup },
  { method: 'post' as const, path: '/api/auth/device/verify', handler: verify },
  { method: 'get' as const, path: '/.well-known/openid-configuration', handler: openidConfiguration },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES)
  h.db.sqlite.exec(readFileSync(new URL('../../scripts/sql/jrkan-clients.sql', import.meta.url), 'utf8'))
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't1', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');
  `)
  h.db.sqlite
    .prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga1', 'user@example.com', ?)`)
    .run(await hashPassword(PASSWORD, 'pepper'))
  h.db.sqlite.exec(`INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u1', 't1', 'ga1', 'user@example.com')`)
})

const browserCookie = async () => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: 'acct-web' } })
  expect(response.status).toBe(200)
  return cookieFrom(response, 'sso_refresh_token')
}

const startDevice = async (clientId = 'leeguoo-jrkan-tv') => {
  const response = await h.request('/device/code', { method: 'POST', form: { client_id: clientId } })
  return { status: response.status, body: (await response.json()) as Record<string, string | number> }
}

const poll = async (code: string, clientId = 'leeguoo-jrkan-tv') => {
  const response = await h.request('/token', { method: 'POST', form: { grant_type: DEVICE_CODE_GRANT, device_code: code, client_id: clientId } })
  return { status: response.status, body: (await response.json()) as Record<string, string> }
}

const decide = (cookie: string, userCode: string, action: 'approve' | 'deny', headers: Record<string, string> = {}) =>
  h.request('/api/auth/device/verify', { method: 'POST', cookie, headers, json: { user_code: userCode, action } })

/** Pretend the device waited out the polling interval since its last poll. */
const waitInterval = () => h.db.sqlite.exec(`UPDATE device_codes SET last_polled_ms = last_polled_ms - 60000`)

describe('user codes', () => {
  it('are 8 unambiguous letters, typed in any case with or without the dash', () => {
    for (let i = 0; i < 50; i += 1) expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/)
    expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDFGHJK')
    expect(normalizeUserCode(' BCDF GHJK ')).toBe('BCDFGHJK')
    expect(normalizeUserCode('BCDF-GHJO')).toBe('')
    expect(normalizeUserCode('BCDF-GHJ')).toBe('')
    expect(normalizeUserCode(undefined)).toBe('')
  })
})

describe('device authorization grant', () => {
  it('is advertised in discovery', async () => {
    const doc = (await (await h.request('/.well-known/openid-configuration')).json()) as Record<string, unknown>
    expect(doc.device_authorization_endpoint).toBe(`${ISSUER}/device/code`)
    expect(doc.grant_types_supported).toContain(DEVICE_CODE_GRANT)
  })

  it('issues codes to device clients only (form or JSON)', async () => {
    const { status, body } = await startDevice()
    expect(status).toBe(200)
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(body.verification_uri).toBe(`${ISSUER}/device`)
    expect(body.verification_uri_complete).toBe(`${ISSUER}/device?user_code=${body.user_code}`)
    expect(body.expires_in).toBe(600)
    expect(body.interval).toBe(5)
    expect(String(body.device_code).length).toBeGreaterThan(40)
    const stored = h.db.sqlite.prepare(`SELECT device_code_hash, user_code FROM device_codes`).get() as Record<string, string>
    expect(stored.device_code_hash).not.toBe(body.device_code)
    expect(stored.user_code).toBe(String(body.user_code).replace('-', ''))

    const json = await h.request('/device/code', { method: 'POST', json: { client_id: 'leeguoo-jrkan-tv', scope: 'openid bogus' } })
    expect(json.status).toBe(200)

    const ios = await startDevice('leeguoo-jrkan-ios')
    expect(ios.status).toBe(400)
    expect(ios.body.error).toBe('unauthorized_client')
    expect((await startDevice('nope')).body.error).toBe('invalid_client')
    expect((await poll('x', 'leeguoo-jrkan-ios')).body.error).toBe('unauthorized_client')
  })

  it('polling: pending, slow_down when too fast, then tokens exactly once after approval', async () => {
    const { body } = await startDevice()
    const code = String(body.device_code)
    expect((await poll(code)).body.error).toBe('authorization_pending')
    const fast = await poll(code)
    expect(fast.status).toBe(400)
    expect(fast.body.error).toBe('slow_down')
    expect((h.db.sqlite.prepare(`SELECT poll_interval FROM device_codes`).get() as { poll_interval: number }).poll_interval).toBe(10)
    waitInterval()
    expect((await poll(code)).body.error).toBe('authorization_pending')

    const cookie = await browserCookie()
    // Lowercase without the dash is the same code.
    const approved = await decide(cookie, String(body.user_code).replace('-', '').toLowerCase(), 'approve')
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ ok: true, status: 'approved', client_id: 'leeguoo-jrkan-tv', client_name: 'JRKAN', device_name: 'Apple TV' })

    const tokens = await poll(code)
    expect(tokens.status).toBe(200)
    expect(tokens.body).toMatchObject({ token_type: 'Bearer', scope: 'openid profile email' })
    expect(tokens.body.refresh_token && tokens.body.id_token).toBeTruthy()
    const claims = decodeJwt(tokens.body.access_token)
    expect(claims).toMatchObject({ aud: 'leeguoo-jrkan-tv', tid: 'tenant-jrkan', gaid: 'ga1', email: 'user@example.com' })
    const user = h.db.sqlite.prepare(`SELECT tenant_id FROM users WHERE id = ?`).get(claims.sub as string) as { tenant_id: string }
    expect(user.tenant_id).toBe('tenant-jrkan')
    const audit = h.db.sqlite.prepare(`SELECT count(*) AS n FROM audit_logs WHERE action = 'auth.token.device_code'`).get() as { n: number }
    expect(audit.n).toBe(1)

    waitInterval()
    expect((await poll(code)).body.error).toBe('invalid_grant')
    expect((await poll(code, 'acct-web')).body.error).toBe('unauthorized_client')

    // The refresh token works for the TV client.
    const refreshed = await h.request('/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token, client_id: 'leeguoo-jrkan-tv' } })
    expect(refreshed.status).toBe(200)
  })

  it('deny → access_denied; expired → expired_token', async () => {
    const cookie = await browserCookie()
    const denied = await startDevice()
    expect((await decide(cookie, String(denied.body.user_code), 'deny')).status).toBe(200)
    expect((await poll(String(denied.body.device_code))).body.error).toBe('access_denied')
    expect((await decide(cookie, String(denied.body.user_code), 'approve')).status).toBe(409)

    const late = await startDevice()
    h.db.sqlite.exec(`UPDATE device_codes SET expires_at = 1 WHERE status = 'pending'`)
    expect((await poll(String(late.body.device_code))).body.error).toBe('expired_token')
    const response = await decide(cookie, String(late.body.user_code), 'approve')
    expect(response.status).toBe(410)
    expect(((await response.json()) as { error: string }).error).toBe('expired_user_code')
  })

  it('approval needs the first-party session cookie from this origin', async () => {
    const { body } = await startDevice()
    const userCode = String(body.user_code)
    const login = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: 'acct-web' } })
    const bearer = ((await login.json()) as { access_token: string }).access_token

    const noCookie = await h.request('/api/auth/device/verify', { method: 'POST', bearer, json: { user_code: userCode, action: 'approve' } })
    expect(noCookie.status).toBe(401)
    expect(((await noCookie.json()) as { error: string }).error).toBe('login_required')

    const cookie = cookieFrom(login, 'sso_refresh_token')
    expect((await decide(cookie, userCode, 'approve', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await decide(cookie, 'BCDF-GHJK', 'approve')).status).toBe(404)
    const sameOrigin = await decide(cookie, userCode, 'approve', { origin: ISSUER })
    expect(await sameOrigin.json()).toMatchObject({ ok: true })
  })

  it('lookup tells the page who is signed in and which app asks', async () => {
    const { body } = await startDevice()
    const anonymous = (await (await h.request(`/api/auth/device/lookup?user_code=${body.user_code}`)).json()) as Record<string, unknown>
    expect(anonymous).toMatchObject({ signed_in: false, email: null, client_id: 'leeguoo-jrkan-tv', client_name: 'JRKAN', status: 'pending' })

    const cookie = await browserCookie()
    const signedIn = (await (await h.request('/api/auth/device/lookup', { cookie })).json()) as Record<string, unknown>
    expect(signedIn).toMatchObject({ signed_in: true, email: 'user@example.com', user_code: null })

    const unknown = await h.request('/api/auth/device/lookup?user_code=ZZZZ-ZZZZ', { cookie })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: 'invalid_user_code', signed_in: true })
  })

  it('rate limits user code guessing per IP', async () => {
    let last = 0
    for (let i = 0; i < 31; i += 1) last = (await h.request('/api/auth/device/lookup?user_code=ZZZZ-ZZZZ')).status
    expect(last).toBe(429)
  })
})

describe('JRKAN clients', () => {
  it('the SQL seed is idempotent and matches the bootstrap seed', () => {
    h.db.sqlite.exec(readFileSync(new URL('../../scripts/sql/jrkan-clients.sql', import.meta.url), 'utf8'))
    const clients = h.db.sqlite
      .prepare(`SELECT client_id, tenant_id, redirect_uris, grant_types, client_secret FROM clients WHERE tenant_id = 'tenant-jrkan' ORDER BY client_id`)
      .all()
    expect(clients).toEqual([
      { client_id: 'leeguoo-jrkan-ios', tenant_id: 'tenant-jrkan', redirect_uris: '["com.leeguoo.jrskan.tv:/oauth/callback"]', grant_types: 'authorization_code pkce refresh_token', client_secret: null },
      { client_id: 'leeguoo-jrkan-tv', tenant_id: 'tenant-jrkan', redirect_uris: '[]', grant_types: `refresh_token ${DEVICE_CODE_GRANT}`, client_secret: null },
    ])
    const counts = h.db.sqlite
      .prepare(
        `SELECT (SELECT count(*) FROM roles WHERE tenant_id = 'tenant-jrkan') AS roles,
                (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.tenant_id = 'tenant-jrkan') AS perms,
                (SELECT count(*) FROM client_roles cr JOIN clients c ON c.id = cr.client_id WHERE c.tenant_id = 'tenant-jrkan') AS client_roles`,
      )
      .get()
    expect(counts).toEqual({ roles: 2, perms: 3, client_roles: 4 })
  })

  it('the iOS/Mac client completes PKCE through its custom-scheme redirect', async () => {
    const cookie = await browserCookie()
    const pkce = await pkcePair()
    const redirectUri = 'com.leeguoo.jrskan.tv:/oauth/callback'
    const query = new URLSearchParams({
      response_type: 'code', client_id: 'leeguoo-jrkan-ios', redirect_uri: redirectUri, scope: 'openid profile email',
      code_challenge: pkce.challenge, code_challenge_method: 'S256', state: 's',
    })
    const response = await h.request(`/authorize?${query}`, { cookie })
    // The browser session belongs to another tenant: sign in again for this client.
    expect(response.status).toBe(302)
    const login = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: 'leeguoo-jrkan-ios' } })
    const authorized = await h.request(`/authorize?${query}`, { cookie: cookieFrom(login, 'sso_refresh_token') })
    const location = authorized.headers.get('location') || ''
    expect(location.startsWith(`${redirectUri}?code=`)).toBe(true)
    const code = new URL(location).searchParams.get('code')!
    const exchanged = await h.request('/token', {
      method: 'POST',
      form: { grant_type: 'authorization_code', client_id: 'leeguoo-jrkan-ios', code, redirect_uri: redirectUri, code_verifier: pkce.verifier },
    })
    expect(exchanged.status).toBe(200)
  })
})
