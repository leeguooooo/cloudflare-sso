import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import options from '../../server/routes/api/auth/passkey/options.post'
import verify from '../../server/routes/api/auth/passkey/verify.post'
import list from '../../server/routes/api/account/passkeys.get'
import manage from '../../server/routes/api/account/passkeys.post'
import { hashPassword } from '../../server/utils/crypto'
import { decodeCbor, derToRawEcdsa } from '../../server/utils/webauthn'
import { createAuthenticator, encodeCbor } from '../helpers/authenticator'
import { cookieFrom, createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/api/auth/passkey/options', handler: options },
  { method: 'post' as const, path: '/api/auth/passkey/verify', handler: verify },
  { method: 'get' as const, path: '/api/account/passkeys', handler: list },
  { method: 'post' as const, path: '/api/account/passkeys', handler: manage },
]

const PASSWORD = 'correct horse battery'
const ORIGIN = 'https://sso.test'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web' })
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-web', 'App', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
  `)
  h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-user', 'user@example.com', ?)`).run(await hashPassword(PASSWORD, 'pepper'))
})

const tokenFor = async () =>
  ((await (await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: 'acct-web' } })).json()) as { access_token: string }).access_token

/** Registers a passkey for user@example.com; returns the authenticator and the token used. */
const enroll = async () => {
  const token = await tokenFor()
  const authenticator = await createAuthenticator('sso.test', ORIGIN)
  const opts = (await (await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'register_options' } })).json()) as {
    challenge_id: string
    publicKey: { challenge: string; rp: { id: string }; user: { id: string } }
  }
  expect(opts.publicKey.rp.id).toBe('sso.test')
  const credential = await authenticator.register(opts.publicKey)
  const saved = await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'register', challenge_id: opts.challenge_id, credential, name: 'MacBook' } })
  expect(saved.status).toBe(200)
  return { authenticator, token, opts }
}

const signIn = async (authenticator: Awaited<ReturnType<typeof createAuthenticator>>, overrides: Record<string, unknown> = {}, clientId = 'app-web') => {
  const opts = (await (await h.request('/api/auth/passkey/options', { method: 'POST', json: {} })).json()) as { challenge_id: string; publicKey: { challenge: string } }
  const credential = await authenticator.assert(opts.publicKey, overrides)
  return h.request('/api/auth/passkey/verify', { method: 'POST', json: { challenge_id: opts.challenge_id, client_id: clientId, credential } })
}

describe('webauthn primitives', () => {
  it('round-trips CBOR maps and converts DER signatures', () => {
    const encoded = encodeCbor(new Map<number | string, number | string | Uint8Array>([[1, 2], [-1, 'x'], ['b', new Uint8Array([1, 2])]]) as never)
    const decoded = decodeCbor(encoded).value as Map<unknown, unknown>
    expect(decoded.get(1)).toBe(2)
    expect(decoded.get(-1)).toBe('x')
    expect([...(decoded.get('b') as Uint8Array)]).toEqual([1, 2])
    const der = new Uint8Array([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x01, 0x02])
    const raw = derToRawEcdsa(der)
    expect(raw[31]).toBe(0x80)
    expect([raw[62], raw[63]]).toEqual([0x01, 0x02])
  })
})

describe('passkeys', () => {
  it('registers a passkey and lists it without key material', async () => {
    const { token } = await enroll()
    const body = (await (await h.request('/api/account/passkeys', { bearer: token })).json()) as { rp_id: string; passkeys: Record<string, unknown>[] }
    expect(body.rp_id).toBe('sso.test')
    expect(body.passkeys).toEqual([expect.objectContaining({ name: 'MacBook', transports: ['internal'] })])
    expect(JSON.stringify(body)).not.toContain('public_key')
  })

  it('signs in with the passkey into any app, without a password or second step', async () => {
    const { authenticator } = await enroll()
    const response = await signIn(authenticator)
    expect(response.status).toBe(200)
    expect(cookieFrom(response, 'sso_refresh_token')).toBeTruthy()
    const tokens = (await response.json()) as { access_token: string; user: { tenant_id: string; email: string } }
    expect(tokens.user).toMatchObject({ tenant_id: 't-app', email: 'user@example.com' })
    const audit = h.db.sqlite.prepare(`SELECT payload_json FROM audit_logs WHERE action = 'auth.login' ORDER BY rowid DESC LIMIT 1`).get() as { payload_json: string }
    expect(JSON.parse(audit.payload_json).second_factor).toBe('passkey')
  })

  it('refuses a replayed challenge, a wrong origin, a cloned counter and a foreign rpId', async () => {
    const { authenticator, token } = await enroll()
    const opts = (await (await h.request('/api/auth/passkey/options', { method: 'POST', json: {} })).json()) as { challenge_id: string; publicKey: { challenge: string } }
    const credential = await authenticator.assert(opts.publicKey)
    expect((await h.request('/api/auth/passkey/verify', { method: 'POST', json: { challenge_id: opts.challenge_id, credential } })).status).toBe(200)
    expect((await h.request('/api/auth/passkey/verify', { method: 'POST', json: { challenge_id: opts.challenge_id, credential } })).status).toBe(400)

    expect((await signIn(authenticator, { origin: 'https://evil.test' })).status).toBe(401)
    expect((await signIn(authenticator, { counter: 1 })).status).toBe(401)

    const regOpts = (await (await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'register_options' } })).json()) as {
      challenge_id: string
      publicKey: { challenge: string; user: { id: string } }
    }
    const other = await createAuthenticator('sso.test', ORIGIN)
    const foreign = await other.register(regOpts.publicKey, { rpId: 'evil.test' })
    const rejected = await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'register', challenge_id: regOpts.challenge_id, credential: foreign } })
    expect(rejected.status).toBe(400)
  })

  it('a suspended account cannot sign in with its passkey', async () => {
    const { authenticator } = await enroll()
    h.db.sqlite.exec(`UPDATE global_accounts SET status = 'disabled' WHERE id = 'ga-user'`)
    expect((await signIn(authenticator)).status).toBe(403)
  })

  it('adding needs a recent sign-in; a deleted passkey no longer works', async () => {
    const { authenticator, token } = await enroll()
    h.db.sqlite.exec(`UPDATE sessions SET auth_time = auth_time - 3600, created_at = created_at - 3600`)
    expect((await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'register_options' } })).status).toBe(403)
    h.db.sqlite.exec(`UPDATE sessions SET auth_time = auth_time + 3600, created_at = created_at + 3600`)

    const del = await h.request('/api/account/passkeys', { method: 'POST', bearer: token, json: { action: 'delete', id: authenticator.credentialId } })
    expect(del.status).toBe(200)
    expect((await signIn(authenticator)).status).toBe(401)
  })
})
