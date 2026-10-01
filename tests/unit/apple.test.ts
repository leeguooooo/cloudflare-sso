import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  appleBool,
  buildAppleAuthorizeUrl,
  clearAppleJwksCache,
  createAppleClientSecret,
  exchangeAppleCode,
  parseAppleUserField,
  readAppleConfig,
  syntheticAppleEmail,
  verifyAppleJwt,
  verifyAppleNotification,
  type AppleConfig,
} from '../../server/utils/apple'
import { base64UrlDecode, base64UrlEncode } from '../../server/utils/crypto'

const enc = new TextEncoder()
const b64json = (value: unknown) => base64UrlEncode(enc.encode(JSON.stringify(value)))

let config: AppleConfig
let ecPublic: CryptoKey
let rsa: CryptoKeyPair
let rsaJwk: JsonWebKey

const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`
}

const signRs256 = async (claims: Record<string, unknown>, kid = 'k1') => {
  const input = `${b64json({ alg: 'RS256', kid })}.${b64json(claims)}`
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, rsa.privateKey, enc.encode(input))
  return `${input}.${base64UrlEncode(new Uint8Array(sig))}`
}

beforeAll(async () => {
  const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  ecPublic = ec.publicKey
  rsa = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  rsaJwk = { ...(await crypto.subtle.exportKey('jwk', rsa.publicKey)), kid: 'k1' } as JsonWebKey
  config = readAppleConfig({
    APPLE_TEAM_ID: '6ZPXG4KVVS',
    APPLE_SERVICES_ID: 'com.leeguoo.account.siwa',
    APPLE_KEY_ID: 'KEY123',
    APPLE_PRIVATE_KEY: toPem(await crypto.subtle.exportKey('pkcs8', ec.privateKey)),
  } as never)!
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAppleJwksCache()
})

const stubApple = (tokenResponse: Record<string, unknown>) => {
  const calls: Array<{ url: string; body?: string }> = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url.endsWith('/auth/keys')) return new Response(JSON.stringify({ keys: [rsaJwk] }))
    if (url.endsWith('/auth/token')) return new Response(JSON.stringify(tokenResponse))
    return new Response('{}', { status: 404 })
  })
  return calls
}

describe('Sign in with Apple', () => {
  it('needs all four secrets', () => {
    expect(readAppleConfig({ APPLE_TEAM_ID: 'x' } as never)).toBeNull()
    expect(config.appIds).toEqual(['com.paste.native'])
    expect(config.issuer).toBe('https://appleid.apple.com')
  })

  it('authorize url uses form_post with name+email scope, state and nonce', () => {
    const url = new URL(buildAppleAuthorizeUrl(config, { redirectUri: 'https://account.leeguoo.com/api/auth/apple/callback', state: 's', nonce: 'n' }))
    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize')
    expect(url.searchParams.get('response_mode')).toBe('form_post')
    expect(url.searchParams.get('scope')).toBe('name email')
    expect(url.searchParams.get('client_id')).toBe('com.leeguoo.account.siwa')
    expect(url.searchParams.get('nonce')).toBe('n')
  })

  it('client_secret is an ES256 JWT Apple accepts', async () => {
    const jwt = await createAppleClientSecret(config, 1000)
    const [h, p, sig] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(h)))).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' })
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(p)))).toEqual({
      iss: '6ZPXG4KVVS', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.leeguoo.account.siwa',
    })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ecPublic, base64UrlDecode(sig), enc.encode(`${h}.${p}`))
    expect(ok).toBe(true)
  })

  it('exchanges the code and verifies the id_token (relay email, name from first auth)', async () => {
    const idToken = await signRs256({
      iss: 'https://appleid.apple.com', aud: 'com.leeguoo.account.siwa', sub: '001.abc', exp: Math.floor(Date.now() / 1000) + 600,
      nonce: 'n1', email: 'XYZ@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true',
    })
    const calls = stubApple({ id_token: idToken, refresh_token: 'r1' })
    const identity = await exchangeAppleCode(config, {
      code: 'c1', redirectUri: 'https://account.leeguoo.com/api/auth/apple/callback', nonce: 'n1',
      userField: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' } }),
    })
    expect(identity).toMatchObject({ subject: '001.abc', email: 'xyz@privaterelay.appleid.com', emailVerified: true, isPrivateEmail: true, name: 'Ada Lovelace', refreshToken: 'r1' })
    const body = new URLSearchParams(calls.find((c) => c.url.endsWith('/auth/token'))!.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_secret')!.split('.')).toHaveLength(3)
  })

  it('later sign-ins without email still key on sub', async () => {
    const idToken = await signRs256({ iss: 'https://appleid.apple.com', aud: 'com.leeguoo.account.siwa', sub: '001.abc', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n' })
    stubApple({ id_token: idToken })
    const identity = await exchangeAppleCode(config, { code: 'c', redirectUri: 'r', nonce: 'n' })
    expect(identity.subject).toBe('001.abc')
    expect(identity.email).toBeUndefined()
    expect(identity.name).toBeUndefined()
  })

  it('rejects wrong audience, nonce, issuer, expiry and forged signatures', async () => {
    stubApple({})
    const base = { iss: 'https://appleid.apple.com', aud: 'com.leeguoo.account.siwa', sub: 's', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n' }
    const expectReject = async (token: string, nonce = 'n') =>
      expect(verifyAppleJwt(config, token, { audiences: [config.servicesId], nonce })).rejects.toMatchObject({ statusCode: 401 })
    await expectReject(await signRs256({ ...base, aud: 'other' }))
    await expectReject(await signRs256(base), 'other-nonce')
    await expectReject(await signRs256({ ...base, iss: 'https://evil.example' }))
    await expectReject(await signRs256({ ...base, exp: 10 }))
    const good = await signRs256(base)
    const [h, , s] = good.split('.')
    await expectReject(`${h}.${b64json({ ...base, sub: 'attacker' })}.${s}`)
  })

  it('verifies server-to-server notifications (events as a JSON string)', async () => {
    stubApple({})
    const payload = await signRs256({
      iss: 'https://appleid.apple.com', aud: 'com.paste.native', exp: Math.floor(Date.now() / 1000) + 600,
      events: JSON.stringify({ type: 'consent-revoked', sub: '001.abc', event_time: 1 }),
    })
    expect(await verifyAppleNotification(config, payload)).toMatchObject({ type: 'consent-revoked', sub: '001.abc' })
  })

  it('helpers', async () => {
    expect(appleBool('true')).toBe(true)
    expect(appleBool(false)).toBe(false)
    expect(appleBool(undefined)).toBeUndefined()
    expect(parseAppleUserField('not json')).toEqual({})
    expect(await syntheticAppleEmail('001.abc')).toMatch(/^apple-[0-9a-f]{20}@users\.account\.invalid$/)
  })
})
