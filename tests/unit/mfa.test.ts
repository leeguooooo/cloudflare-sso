import { beforeEach, describe, expect, it } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import mfaVerify from '../../server/routes/api/auth/mfa/verify.post'
import mfaStatus from '../../server/routes/api/account/mfa.get'
import mfaManage from '../../server/routes/api/account/mfa.post'
import accountAction from '../../server/routes/api/admin/accounts/[id].post'
import { hashPassword } from '../../server/utils/crypto'
import { base32Encode, decryptSecret, encryptSecret, totpCode, totpStep, verifyTotp } from '../../server/utils/totp'
import { cookieFrom, createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/api/auth/mfa/verify', handler: mfaVerify },
  { method: 'get' as const, path: '/api/account/mfa', handler: mfaStatus },
  { method: 'post' as const, path: '/api/account/mfa', handler: mfaManage },
  { method: 'post' as const, path: '/api/admin/accounts/:id', handler: accountAction },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', MFA_SECRET_KEY: 'test-mfa-key' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-web', 'App', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't-platform', 'admin');
  `)
  for (const [ga, email] of [['ga-root', 'root@example.com'], ['ga-user', 'user@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash, password_set) VALUES (?, ?, ?, 1)`).run(ga, email, hash)
  }
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u-root', 't-platform', 'ga-root', 'root@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-root', 'r-admin');
  `)
})

const now = () => Math.floor(Date.now() / 1000)

const passwordLogin = (email: string, clientId = 'acct-web', password = PASSWORD) =>
  h.request('/api/auth/login', { method: 'POST', json: { email, password, client_id: clientId } })

const tokenFor = async (email: string) => ((await (await passwordLogin(email)).json()) as { access_token: string }).access_token

/** Turns on two-step verification for user@example.com; returns the secret, recovery codes and the access token used. */
const enroll = async () => {
  const token = await tokenFor('user@example.com')
  const start = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'start' } })
  expect(start.status).toBe(200)
  const { secret, otpauth_uri } = (await start.json()) as { secret: string; otpauth_uri: string }
  expect(otpauth_uri).toContain(`secret=${secret}`)
  const confirm = await h.request('/api/account/mfa', {
    method: 'POST',
    bearer: token,
    json: { action: 'confirm', code: await totpCode(secret, totpStep(now())) },
  })
  expect(confirm.status).toBe(200)
  const { recovery_codes } = (await confirm.json()) as { recovery_codes: string[] }
  return { secret, recoveryCodes: recovery_codes, token }
}

describe('totp primitives', () => {
  it('matches the RFC 6238 SHA-1 test vector', async () => {
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
    expect(await totpCode(secret, totpStep(59))).toBe('287082')
    expect(await totpCode(secret, totpStep(1111111109))).toBe('081804')
  })

  it('accepts one step of drift and refuses a step already used', async () => {
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
    const t = 1111111109
    expect(await verifyTotp(secret, await totpCode(secret, totpStep(t) - 1), t)).toBe(totpStep(t) - 1)
    expect(await verifyTotp(secret, await totpCode(secret, totpStep(t) - 2), t)).toBeNull()
    expect(await verifyTotp(secret, await totpCode(secret, totpStep(t)), t, totpStep(t))).toBeNull()
  })

  it('seals secrets so only the same key opens them', async () => {
    const sealed = await encryptSecret('key-a', 'JBSWY3DPEHPK3PXP')
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP')
    expect(await decryptSecret('key-a', sealed)).toBe('JBSWY3DPEHPK3PXP')
    await expect(decryptSecret('key-b', sealed)).rejects.toThrow()
  })
})

describe('two-step verification', () => {
  it('enrolment hands out ten recovery codes and stores no plaintext secret', async () => {
    const { secret, recoveryCodes } = await enroll()
    expect(recoveryCodes).toHaveLength(10)
    const row = h.db.sqlite.prepare(`SELECT totp_secret, recovery_codes_json FROM account_mfa WHERE global_account_id = 'ga-user'`).get() as Record<string, string>
    expect(row.totp_secret).not.toContain(secret)
    expect(row.recovery_codes_json).not.toContain(recoveryCodes[0])
  })

  it('a wrong confirmation code does not turn it on', async () => {
    const token = await tokenFor('user@example.com')
    await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'start' } })
    const confirm = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'confirm', code: '000000' } })
    expect(confirm.status).toBe(400)
    const status = (await (await h.request('/api/account/mfa', { bearer: token })).json()) as { enabled: boolean }
    expect(status.enabled).toBe(false)
  })

  it('password sign-in stops at a challenge, then completes with the authenticator code once', async () => {
    const { secret } = await enroll()
    const first = await passwordLogin('user@example.com', 'app-web')
    expect(first.status).toBe(200)
    expect(cookieFrom(first, 'sso_refresh_token')).toBeFalsy()
    const body = (await first.json()) as { mfa_required: boolean; challenge: string; access_token?: string }
    expect(body.mfa_required).toBe(true)
    expect(body.access_token).toBeUndefined()

    const wrong = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: body.challenge, code: '000000' } })
    expect(wrong.status).toBe(401)

    // Enrolment spent the current step; the next one is inside the drift window.
    const code = await totpCode(secret, totpStep(now()) + 1)
    const ok = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: body.challenge, code } })
    expect(ok.status).toBe(200)
    expect(cookieFrom(ok, 'sso_refresh_token')).toBeTruthy()
    const tokens = (await ok.json()) as { access_token: string; user: { tenant_id: string } }
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.user.tenant_id).toBe('t-app')

    const replay = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: body.challenge, code } })
    expect(replay.status).toBe(401)
  })

  it('a recovery code works exactly once', async () => {
    const { recoveryCodes } = await enroll()
    const challenge = async () => ((await (await passwordLogin('user@example.com')).json()) as { challenge: string }).challenge
    const used = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: await challenge(), code: recoveryCodes[3].toUpperCase() } })
    expect(used.status).toBe(200)
    expect(((await used.json()) as { recovery_codes_remaining: number }).recovery_codes_remaining).toBe(9)
    const again = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: await challenge(), code: recoveryCodes[3] } })
    expect(again.status).toBe(401)
  })

  it('wrong codes use up the sign-in budget', async () => {
    await enroll()
    const { challenge } = (await (await passwordLogin('user@example.com')).json()) as { challenge: string }
    let last = 0
    for (let i = 0; i < 11; i++) {
      last = (await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge, code: '000000' } })).status
    }
    expect(last).toBe(429)
  })

  it('a challenge is not an access token, and a forged one is refused', async () => {
    await enroll()
    const { challenge } = (await (await passwordLogin('user@example.com')).json()) as { challenge: string }
    expect((await h.request('/api/account/mfa', { bearer: challenge })).status).toBe(401)
    const forged = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge: `${challenge}x`, code: '123456' } })
    expect(forged.status).toBe(401)
  })

  it('a suspended account cannot finish the second step', async () => {
    const { secret } = await enroll()
    const { challenge } = (await (await passwordLogin('user@example.com')).json()) as { challenge: string }
    h.db.sqlite.exec(`UPDATE global_accounts SET status = 'disabled' WHERE id = 'ga-user'`)
    const response = await h.request('/api/auth/mfa/verify', { method: 'POST', json: { challenge, code: await totpCode(secret, totpStep(now()) + 1) } })
    expect(response.status).toBe(403)
  })

  it('managing it needs a recent sign-in, and turning it off needs a code', async () => {
    const { secret, token } = await enroll()
    const noCode = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'disable' } })
    expect(noCode.status).toBe(400)

    h.db.sqlite.exec(`UPDATE sessions SET auth_time = auth_time - 3600, created_at = created_at - 3600`)
    const stale = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'disable', code: await totpCode(secret, totpStep(now()) + 1) } })
    expect(stale.status).toBe(403)
    h.db.sqlite.exec(`UPDATE sessions SET auth_time = auth_time + 3600, created_at = created_at + 3600`)

    const off = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'disable', code: await totpCode(secret, totpStep(now()) + 1) } })
    expect(off.status).toBe(200)
    const after = (await (await passwordLogin('user@example.com')).json()) as { access_token?: string }
    expect(after.access_token).toBeTruthy()
  })

  it('is unavailable when no secret key is configured (the public pepper is never used)', async () => {
    h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web' })
    const hash = await hashPassword(PASSWORD, 'pepper')
    h.db.sqlite.exec(`INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform');
      INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
        VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');`)
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash, password_set) VALUES ('ga-user', 'user@example.com', ?, 1)`).run(hash)
    const token = await tokenFor('user@example.com')
    const start = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'start' } })
    expect(start.status).toBe(500)
  })

  it('accounts without a password cannot enrol', async () => {
    const token = await tokenFor('user@example.com')
    h.db.sqlite.exec(`UPDATE global_accounts SET password_set = 0 WHERE id = 'ga-user'`)
    const start = await h.request('/api/account/mfa', { method: 'POST', bearer: token, json: { action: 'start' } })
    expect(start.status).toBe(400)
  })

  it('a platform admin can reset it for a locked-out user', async () => {
    await enroll()
    const root = await tokenFor('root@example.com')
    const reset = await h.request('/api/admin/accounts/ga-user', { method: 'POST', bearer: root, json: { action: 'reset_mfa' } })
    expect(reset.status).toBe(200)
    expect(((await reset.json()) as { removed: boolean }).removed).toBe(true)
    const login = (await (await passwordLogin('user@example.com')).json()) as { access_token?: string }
    expect(login.access_token).toBeTruthy()
  })
})
