import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import native from '../../server/routes/api/auth/apple/native.post'
import deleteAccount from '../../server/routes/api/account/index.delete'
import { appleNonceHash, clearAppleJwksCache, readAppleConfig, revokeAppleToken } from '../../server/utils/apple'
import { base64UrlDecode, base64UrlEncode, hashPassword } from '../../server/utils/crypto'
import { createHarness, decodeJwt } from '../helpers/harness'

const enc = new TextEncoder()
const b64json = (value: unknown) => base64UrlEncode(enc.encode(JSON.stringify(value)))
const BUNDLE_ID = 'com.leeguoo.jrskan.tv'
const SERVICES_ID = 'com.leeguoo.account.siwa'

let rsa: CryptoKeyPair
let rsaJwk: JsonWebKey
let applePrivateKey = ''

const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`
}

const signRs256 = async (claims: Record<string, unknown>) => {
  const input = `${b64json({ alg: 'RS256', kid: 'k1' })}.${b64json(claims)}`
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, rsa.privateKey, enc.encode(input))
  return `${input}.${base64UrlEncode(new Uint8Array(sig))}`
}

const jwtClaims = (jwt: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(jwt.split('.')[1]))) as Record<string, unknown>

beforeAll(async () => {
  rsa = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  rsaJwk = { ...(await crypto.subtle.exportKey('jwk', rsa.publicKey)), kid: 'k1' } as JsonWebKey
  const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  applePrivateKey = toPem(await crypto.subtle.exportKey('pkcs8', ec.privateKey))
})

const appleEnv = () => ({
  APPLE_TEAM_ID: '6ZPXG4KVVS',
  APPLE_SERVICES_ID: SERVICES_ID,
  APPLE_KEY_ID: 'KEY123',
  APPLE_PRIVATE_KEY: applePrivateKey,
  APPLE_APP_IDS: `com.paste.native,${BUNDLE_ID}`,
  SIWA_ENABLED: '1',
})

let h: Awaited<ReturnType<typeof createHarness>>
let appleCalls: Array<{ url: string; body: URLSearchParams }>
let tokenResponse: () => Promise<Record<string, unknown>> | Record<string, unknown>

const setup = async (env: Record<string, string> = appleEnv()) => {
  h = await createHarness(
    [
      { method: 'post', path: '/api/auth/apple/native', handler: native },
      { method: 'delete', path: '/api/account', handler: deleteAccount },
    ],
    env,
  )
  h.db.sqlite.exec(readFileSync(new URL('../../scripts/sql/jrkan-clients.sql', import.meta.url), 'utf8'))
  h.db.sqlite
    .prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga-pw', 'taken@example.com', ?)`)
    .run(await hashPassword('correct horse battery', 'pepper'))
}

beforeEach(async () => {
  appleCalls = []
  tokenResponse = () => ({})
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    appleCalls.push({ url, body: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') })
    if (url.endsWith('/auth/keys')) return new Response(JSON.stringify({ keys: [rsaJwk] }))
    if (url.endsWith('/auth/token')) return new Response(JSON.stringify(await tokenResponse()))
    if (url.endsWith('/auth/revoke')) return new Response('')
    return new Response('{}', { status: 404 })
  })
  await setup()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAppleJwksCache()
})

const identityToken = async (nonce: string, over: Record<string, unknown> = {}) =>
  signRs256({
    iss: 'https://appleid.apple.com',
    aud: BUNDLE_ID,
    sub: '001.jrkan',
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: await appleNonceHash(nonce),
    email: 'Fan@PrivateRelay.AppleID.com',
    email_verified: 'true',
    is_private_email: 'true',
    ...over,
  })

const signIn = (body: Record<string, unknown>) => h.request('/api/auth/apple/native', { method: 'POST', json: body })

describe('native Sign in with Apple', () => {
  it('creates the account, returns SSO tokens and keeps the refresh token with its bundle id', async () => {
    tokenResponse = async () => ({ id_token: await identityToken('raw-nonce'), refresh_token: 'apple-refresh' })
    const response = await signIn({
      client_id: 'leeguoo-jrkan-tv',
      identity_token: await identityToken('raw-nonce'),
      nonce: 'raw-nonce',
      authorization_code: 'native-code',
      given_name: 'Ada',
      family_name: 'Lovelace',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, string | number>
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_in', 'id_token', 'refresh_token', 'scope', 'token_type'])
    expect(decodeJwt(String(body.access_token))).toMatchObject({ aud: 'leeguoo-jrkan-tv', tid: 'tenant-jrkan', email: 'fan@privaterelay.appleid.com' })

    const exchange = appleCalls.find((call) => call.url.endsWith('/auth/token'))!
    expect(exchange.body.get('client_id')).toBe(BUNDLE_ID)
    expect(exchange.body.get('code')).toBe('native-code')
    expect(exchange.body.has('redirect_uri')).toBe(false)
    expect(jwtClaims(exchange.body.get('client_secret')!).sub).toBe(BUNDLE_ID)

    const identity = h.db.sqlite
      .prepare(`SELECT refresh_token, refresh_token_client_id, email_verified, is_private_email FROM global_external_identities WHERE provider = 'apple' AND subject = '001.jrkan'`)
      .get()
    expect(identity).toEqual({ refresh_token: 'apple-refresh', refresh_token_client_id: BUNDLE_ID, email_verified: 1, is_private_email: 1 })
    const account = h.db.sqlite.prepare(`SELECT display_name, password_set FROM global_accounts WHERE email = 'fan@privaterelay.appleid.com'`).get()
    expect(account).toEqual({ display_name: 'Ada Lovelace', password_set: 0 })
    const audit = h.db.sqlite.prepare(`SELECT payload_json FROM audit_logs WHERE action = 'auth.apple_native'`).get() as { payload_json: string }
    expect(JSON.parse(audit.payload_json)).toMatchObject({ client_id: 'leeguoo-jrkan-tv', apple_client_id: BUNDLE_ID, apple_refresh_token_stored: true })

    // Signing in again (no email, no name, no code) lands on the same account.
    const again = await signIn({ client_id: 'leeguoo-jrkan-ios', identity_token: await identityToken('n2', { email: undefined }), nonce: 'n2' })
    expect(again.status).toBe(200)
    expect((h.db.sqlite.prepare(`SELECT count(*) AS n FROM global_external_identities`).get() as { n: number }).n).toBe(1)
  })

  it('account deletion revokes the Apple token with the client it belongs to', async () => {
    tokenResponse = async () => ({ id_token: await identityToken('n'), refresh_token: 'apple-refresh' })
    const response = await signIn({ client_id: 'leeguoo-jrkan-ios', identity_token: await identityToken('n'), nonce: 'n', authorization_code: 'c' })
    const { access_token: accessToken } = (await response.json()) as { access_token: string }
    appleCalls = []
    expect((await h.request('/api/account', { method: 'DELETE', bearer: accessToken })).status).toBe(200)
    const revoke = appleCalls.find((call) => call.url.endsWith('/auth/revoke'))!
    expect(revoke.body.get('client_id')).toBe(BUNDLE_ID)
    expect(revoke.body.get('token')).toBe('apple-refresh')
    expect(jwtClaims(revoke.body.get('client_secret')!).sub).toBe(BUNDLE_ID)

    // Tokens stored before the client was recorded belong to the Services ID.
    appleCalls = []
    await revokeAppleToken(readAppleConfig(appleEnv() as never)!, 'old-token', null)
    expect(appleCalls[0].body.get('client_id')).toBe(SERVICES_ID)
  })

  it('a failed code exchange does not fail the sign-in', async () => {
    tokenResponse = () => ({ error: 'invalid_grant' })
    const response = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n'), nonce: 'n', authorization_code: 'bad' })
    expect(response.status).toBe(200)
    const identity = h.db.sqlite.prepare(`SELECT refresh_token FROM global_external_identities`).get() as { refresh_token: string | null }
    expect(identity.refresh_token).toBeNull()
  })

  it('ignores a code that belongs to another Apple user', async () => {
    tokenResponse = async () => ({ id_token: await identityToken('n', { sub: '001.someone-else' }), refresh_token: 'foreign' })
    const response = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n'), nonce: 'n', authorization_code: 'c' })
    expect(response.status).toBe(200)
    expect((h.db.sqlite.prepare(`SELECT refresh_token FROM global_external_identities`).get() as { refresh_token: string | null }).refresh_token).toBeNull()
  })

  it('rejects bad input, wrong nonce, foreign audiences and unknown clients', async () => {
    const missing = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n') })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' })

    const wrongNonce = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n'), nonce: 'other' })
    expect(wrongNonce.status).toBe(401)
    expect(await wrongNonce.json()).toMatchObject({ error: 'invalid_token' })

    // The raw nonce in the claim instead of its hash is a replayed / misbuilt token.
    const rawInClaim = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n', { nonce: 'n' }), nonce: 'n' })
    expect(rawInClaim.status).toBe(401)

    const foreign = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n', { aud: 'com.other.app' }), nonce: 'n' })
    expect(foreign.status).toBe(401)

    const unknown = await signIn({ client_id: 'nope', identity_token: await identityToken('n'), nonce: 'n' })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ error: 'invalid_client' })
  })

  it('an email owned by an unlinked account answers 409 account_exists', async () => {
    const response = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n', { email: 'taken@example.com', is_private_email: 'false' }), nonce: 'n' })
    expect(response.status).toBe(409)
    const body = (await response.json()) as Record<string, string>
    expect(body).toMatchObject({ error: 'account_exists', email: 'taken@example.com' })
    expect(body.error_description).toBeTruthy()
  })

  it('501 when Apple is not configured or switched off', async () => {
    await setup({ ...appleEnv(), SIWA_ENABLED: '0' })
    const off = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n'), nonce: 'n' })
    expect(off.status).toBe(501)
    expect(await off.json()).toMatchObject({ error: 'not_configured' })

    await setup({ SIWA_ENABLED: '1' })
    const unconfigured = await signIn({ client_id: 'leeguoo-jrkan-tv', identity_token: await identityToken('n'), nonce: 'n' })
    expect(unconfigured.status).toBe(501)
  })
})
