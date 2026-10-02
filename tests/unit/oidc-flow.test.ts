import { beforeEach, describe, expect, it } from 'vitest'
import authorize from '../../server/routes/authorize.get'
import token from '../../server/routes/token.post'
import userinfo from '../../server/routes/userinfo.get'
import revoke from '../../server/routes/revoke.post'
import logout from '../../server/routes/logout'
import login from '../../server/routes/api/auth/login.post'
import refresh from '../../server/routes/api/auth/refresh.post'
import openidConfiguration from '../../server/routes/.well-known/openid-configuration.get'
import { hashPassword } from '../../server/utils/crypto'
import { cookieFrom, createHarness, decodeJwt, ISSUER, pkcePair } from '../helpers/harness'

const ROUTES = [
  { method: 'get' as const, path: '/authorize', handler: authorize },
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'get' as const, path: '/userinfo', handler: userinfo },
  { method: 'post' as const, path: '/revoke', handler: revoke },
  { method: 'use' as const, path: '/logout', handler: logout },
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/api/auth/refresh', handler: refresh },
  { method: 'get' as const, path: '/.well-known/openid-configuration', handler: openidConfiguration },
]

const APP_REDIRECT = 'https://app.test/callback'
const PASSWORD = 'correct horse battery'

let h: Awaited<ReturnType<typeof createHarness>>

const seed = async () => {
  h = await createHarness(ROUTES)
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant One'), ('t2', 'Tenant Two');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't1', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't1', 'app-web', 'App', '["${APP_REDIRECT}"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-other', 't2', 'other-web', 'Other', '["https://other.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
  `)
  h.db.sqlite
    .prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES ('ga1', 'user@example.com', ?)`)
    .run(hash)
  h.db.sqlite.exec(`INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u1', 't1', 'ga1', 'user@example.com')`)
}

const signIn = async (clientId = 'acct-web') => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: clientId } })
  expect(response.status).toBe(200)
  return { cookie: cookieFrom(response, 'sso_refresh_token'), body: (await response.json()) as Record<string, string> }
}

const authorizeUrl = (params: Record<string, string>) =>
  `/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'app-web', redirect_uri: APP_REDIRECT, scope: 'openid profile email', ...params })}`

const getCode = async (cookie: string, extra: Record<string, string> = {}) => {
  const pkce = await pkcePair()
  const response = await h.request(authorizeUrl({ code_challenge: pkce.challenge, code_challenge_method: 'S256', state: 's1', ...extra }), { cookie })
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') || '')
  return { code: location.searchParams.get('code') || '', verifier: pkce.verifier, location }
}

const exchange = (form: Record<string, string>) => h.request('/token', { method: 'POST', form: { client_id: 'app-web', ...form } })

beforeEach(seed)

describe('/authorize', () => {
  it('requires PKCE from public clients, reported back to the client', async () => {
    const { cookie } = await signIn()
    const response = await h.request(authorizeUrl({ state: 'xyz' }), { cookie })
    const location = new URL(response.headers.get('location') || '')
    expect(location.origin + location.pathname).toBe(APP_REDIRECT)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('state')).toBe('xyz')
  })

  it('prompt=none without a session redirects with login_required instead of a JSON 401', async () => {
    const pkce = await pkcePair()
    const response = await h.request(authorizeUrl({ prompt: 'none', state: 'st', code_challenge: pkce.challenge }))
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') || '')
    expect(location.searchParams.get('error')).toBe('login_required')
    expect(location.searchParams.get('state')).toBe('st')
  })

  it('does not accept a bearer token as a sign-in', async () => {
    const { body } = await signIn()
    const pkce = await pkcePair()
    const response = await h.request(authorizeUrl({ code_challenge: pkce.challenge }), { bearer: body.access_token })
    expect(response.headers.get('location')).toMatch(/^\/login\?/)
  })

  it('prompt=login sends a signed-in user back to the login page without looping', async () => {
    const { cookie } = await signIn()
    const pkce = await pkcePair()
    const response = await h.request(authorizeUrl({ prompt: 'login', code_challenge: pkce.challenge }), { cookie })
    const location = response.headers.get('location') || ''
    expect(location).toMatch(/^\/login\?/)
    expect(location).toContain('reauth=1')
    expect(decodeURIComponent(location)).not.toContain('prompt=login')
  })
})

describe('/token authorization_code', () => {
  it('issues tokens with nonce and auth_time, and the code works only once', async () => {
    const { cookie } = await signIn()
    const { code, verifier, location } = await getCode(cookie, { nonce: 'n-123' })
    expect(location.searchParams.get('state')).toBe('s1')

    const response = await exchange({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, code_verifier: verifier })
    expect(response.status).toBe(200)
    const tokens = (await response.json()) as Record<string, string>
    const idToken = decodeJwt(tokens.id_token)
    expect(idToken.nonce).toBe('n-123')
    expect(idToken.aud).toBe('app-web')
    expect(idToken.iss).toBe(ISSUER)
    expect(typeof idToken.auth_time).toBe('number')

    const again = await exchange({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, code_verifier: verifier })
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('rejects a wrong code_verifier with an OAuth error body', async () => {
    const { cookie } = await signIn()
    const { code } = await getCode(cookie)
    const response = await exchange({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, code_verifier: 'x'.repeat(43) })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_grant', error_description: 'Invalid code_verifier' })
  })

  it('reports unknown grant types the OAuth way', async () => {
    const response = await exchange({ grant_type: 'password' })
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' })
  })
})

describe('refresh tokens', () => {
  const codeTokens = async () => {
    const { cookie } = await signIn()
    const { code, verifier } = await getCode(cookie)
    const response = await exchange({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, code_verifier: verifier })
    return (await response.json()) as Record<string, string>
  }

  it('rotates, keeps the granted scope and auth_time', async () => {
    const first = await codeTokens()
    const response = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
    expect(response.status).toBe(200)
    const next = (await response.json()) as Record<string, string>
    expect(next.refresh_token).not.toBe(first.refresh_token)
    expect(next.scope).toBe('openid profile email')
    expect(decodeJwt(next.id_token).auth_time).toBe(decodeJwt(first.id_token).auth_time)
  })

  it('a replayed refresh token after the grace window revokes the session', async () => {
    const first = await codeTokens()
    const rotated = (await (await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json()) as Record<string, string>
    h.db.sqlite.exec(`UPDATE sessions SET rotated_at = rotated_at - 3600`)

    const replay = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' })
    // The legitimate holder of the newest token is cut off too: the family is burned.
    const afterReplay = await exchange({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token })
    expect(await afterReplay.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('a concurrent double refresh inside the grace window does not revoke the session', async () => {
    const first = await codeTokens()
    const rotated = (await (await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json()) as Record<string, string>
    const racer = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
    expect(racer.status).toBe(400)
    const ok = await exchange({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token })
    expect(ok.status).toBe(200)
  })

  it('a disabled user can no longer refresh', async () => {
    const first = await codeTokens()
    h.db.sqlite.exec(`UPDATE global_accounts SET status = 'disabled'`)
    const response = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
    expect(response.status).toBe(403)
  })
})

describe('/userinfo, /revoke, /logout', () => {
  const appTokens = async () => {
    const { cookie } = await signIn()
    const { code, verifier } = await getCode(cookie)
    const response = await exchange({ grant_type: 'authorization_code', code, redirect_uri: APP_REDIRECT, code_verifier: verifier })
    return { cookie, tokens: (await response.json()) as Record<string, string> }
  }

  it('userinfo reports picture and a truthful email_verified', async () => {
    const { tokens } = await appTokens()
    h.db.sqlite.exec(`UPDATE global_accounts SET avatar_url = 'https://cdn.test/a.png'`)
    const response = await h.request('/userinfo', { bearer: tokens.access_token })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.sub).toBe('u1')
    expect(body.email_verified).toBe(false)
    expect(body.picture).toBe('https://cdn.test/a.png')

    // A Google identity that vouches for the account email flips email_verified.
    h.db.sqlite.exec(`INSERT INTO global_external_identities (id, global_account_id, provider, subject, email, email_verified)
                      VALUES ('gi1', 'ga1', 'google', 'g-1', 'USER@example.com', 1)`)
    const verified = (await (await h.request('/userinfo', { bearer: tokens.access_token })).json()) as Record<string, unknown>
    expect(verified.email_verified).toBe(true)
  })

  it('userinfo refuses id tokens', async () => {
    const { tokens } = await appTokens()
    const response = await h.request('/userinfo', { bearer: tokens.id_token })
    expect(response.status).toBe(401)
  })

  it('revoking the refresh token kills the access token at /userinfo immediately', async () => {
    const { tokens } = await appTokens()
    const revoked = await h.request('/revoke', { method: 'POST', form: { client_id: 'app-web', token: tokens.refresh_token } })
    expect(revoked.status).toBe(200)
    expect((await h.request('/userinfo', { bearer: tokens.access_token })).status).toBe(401)
  })

  it('another client cannot revoke this client’s token, and the endpoint still answers 200', async () => {
    const { tokens } = await appTokens()
    const response = await h.request('/revoke', { method: 'POST', form: { client_id: 'acct-web', token: tokens.refresh_token } })
    expect(response.status).toBe(200)
    expect((await h.request('/userinfo', { bearer: tokens.access_token })).status).toBe(200)
  })

  it('RP-initiated logout revokes the RP session and honours a same-origin redirect', async () => {
    const { tokens, cookie } = await appTokens()
    const response = await h.request(
      `/logout?${new URLSearchParams({ id_token_hint: tokens.id_token, post_logout_redirect_uri: 'https://app.test/bye', state: 'q' })}`,
      { cookie },
    )
    expect(response.headers.get('location')).toBe('https://app.test/bye?state=q')
    expect((await h.request('/userinfo', { bearer: tokens.access_token })).status).toBe(401)
  })

  it('logout never redirects to an origin the client did not register', async () => {
    const { tokens } = await appTokens()
    const response = await h.request(
      `/logout?${new URLSearchParams({ id_token_hint: tokens.id_token, post_logout_redirect_uri: 'https://evil.test/' })}`,
    )
    expect(response.headers.get('location')).toMatch(/^\/login\?signed_out=1/)
  })
})

describe('login hardening', () => {
  it('locks an email out after repeated failures', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: 'nope', client_id: 'acct-web' } })
      expect(response.status).toBe(401)
    }
    const locked = await h.request('/api/auth/login', { method: 'POST', json: { email: 'user@example.com', password: PASSWORD, client_id: 'acct-web' } })
    expect(locked.status).toBe(429)
  })
})

describe('discovery', () => {
  it('advertises only endpoints that exist', async () => {
    const doc = (await (await h.request('/.well-known/openid-configuration')).json()) as Record<string, unknown>
    expect(doc.revocation_endpoint).toBe(`${ISSUER}/revoke`)
    expect(doc.end_session_endpoint).toBe(`${ISSUER}/logout`)
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256'])
  })
})
