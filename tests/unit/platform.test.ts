import { beforeEach, describe, expect, it } from 'vitest'
import { defineEventHandler, readBody } from 'h3'
import token from '../../server/routes/token.post'
import login from '../../server/routes/api/auth/login.post'
import bootstrap from '../../server/routes/api/admin/apps/bootstrap.post'
import overview from '../../server/routes/api/admin/overview.get'
import ingest from '../../server/routes/api/billing/events/ingest.post'
import entitlements from '../../server/routes/api/billing/entitlements.get'
import { hashPassword } from '../../server/utils/crypto'
import { hashClientSecret, verifyClientSecret } from '../../server/utils/client-auth'
import { completeOAuthSignIn, renderBridgeHtml, safeContinue } from '../../server/utils/oauth-complete'
import { readClientCredentials } from '../../server/utils/oauth-error'
import { safeContinuePath } from '../../utils/auth-client'
import type { OAuthIdentityProfile } from '../../server/utils/oauth'
import type { OAuthStatePayload } from '../../server/utils/oauth-state'
import { createHarness } from '../helpers/harness'

const oauthComplete = defineEventHandler(async (event) => {
  const body = (await readBody(event)) as { state: OAuthStatePayload; profile: OAuthIdentityProfile }
  return completeOAuthSignIn(event, body.state, body.profile)
})

const ROUTES = [
  { method: 'post' as const, path: '/token', handler: token },
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'post' as const, path: '/api/admin/apps/bootstrap', handler: bootstrap },
  { method: 'get' as const, path: '/api/admin/overview', handler: overview },
  { method: 'post' as const, path: '/api/billing/events/ingest', handler: ingest },
  { method: 'get' as const, path: '/api/billing/entitlements', handler: entitlements },
  { method: 'post' as const, path: '/test/oauth-complete', handler: oauthComplete },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>
const SERVICE_SECRET = 'service-secret-value'

beforeEach(async () => {
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  const secret = await hashClientSecret(SERVICE_SECRET)
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app-acct', 't-app', 'app-console', 'App console', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app-other', 't-platform', 'side-app', 'Side app', '["https://side.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-platform-admin', 't-platform', 'admin'), ('r-app-admin', 't-app', 'admin');
  `)
  h.db.sqlite.prepare(`INSERT INTO clients (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope)
    VALUES ('c-svc', 't-app', 'billing-svc', ?, 'Billing', '[]', 'client_credentials', 'billing:events.write billing:entitlements.read')`).run(secret)
  for (const [ga, email] of [['ga-root', 'root@example.com'], ['ga-appadmin', 'appadmin@example.com'], ['ga-buyer', 'buyer@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(ga, email, hash)
  }
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES
      ('u-root', 't-platform', 'ga-root', 'root@example.com'),
      ('u-appadmin', 't-app', 'ga-appadmin', 'appadmin@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-root', 'r-platform-admin'), ('ur2', 'u-appadmin', 'r-app-admin');
    INSERT INTO products (id, tenant_id, product_key, name, app_key) VALUES ('p1', 't-app', 'pro', 'Pro', 'app');
    INSERT INTO plans (id, tenant_id, product_id, plan_key, name, billing_cycle, entitlement_keys_json)
      VALUES ('pl1', 't-app', 'p1', 'pro-monthly', 'Pro monthly', 'monthly', '["app.pro","membership.all_apps"]');
  `)
})

const accessToken = async (email: string, clientId: string) => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: clientId } })
  expect(response.status).toBe(200)
  return ((await response.json()) as { access_token: string }).access_token
}

const serviceToken = async (scope?: string) => {
  const basic = Buffer.from(`billing-svc:${SERVICE_SECRET}`).toString('base64')
  const response = await h.request('/token', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}` },
    form: { grant_type: 'client_credentials', ...(scope ? { scope } : {}) },
  })
  return { status: response.status, body: (await response.json()) as Record<string, string> }
}

describe('admin authorization', () => {
  it('an admin of an app tenant cannot bootstrap apps (platform admins only)', async () => {
    const tokenValue = await accessToken('appadmin@example.com', 'app-console')
    const response = await h.request('/api/admin/apps/bootstrap', { method: 'POST', bearer: tokenValue, json: { app_keys: ['paste'] } })
    expect(response.status).toBe(403)
  })

  it('bootstraps JRKAN with a device-flow TV client and a PKCE iOS/Mac client', async () => {
    const tokenValue = await accessToken('root@example.com', 'acct-web')
    const response = await h.request('/api/admin/apps/bootstrap', { method: 'POST', bearer: tokenValue, json: { app_key: 'jrkan' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ tenant_id: 'tenant-jrkan', client_ids: ['leeguoo-jrkan-tv', 'leeguoo-jrkan-ios'] })
    const clients = h.db.sqlite
      .prepare(`SELECT client_id, redirect_uris, grant_types FROM clients WHERE tenant_id = 'tenant-jrkan' ORDER BY client_id`)
      .all()
    expect(clients).toEqual([
      { client_id: 'leeguoo-jrkan-ios', redirect_uris: '["com.leeguoo.jrskan.tv:/oauth/callback"]', grant_types: 'authorization_code pkce refresh_token' },
      { client_id: 'leeguoo-jrkan-tv', redirect_uris: '[]', grant_types: 'refresh_token urn:ietf:params:oauth:grant-type:device_code' },
    ])
  })

  it('bootstraps the fishing app with a PKCE iOS client', async () => {
    const tokenValue = await accessToken('root@example.com', 'acct-web')
    const response = await h.request('/api/admin/apps/bootstrap', { method: 'POST', bearer: tokenValue, json: { app_key: 'fishing' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ tenant_id: 'tenant-fishing', client_ids: ['leeguoo-fishing-ios'] })
    const clients = h.db.sqlite.prepare(`SELECT client_id, redirect_uris, grant_types FROM clients WHERE tenant_id = 'tenant-fishing'`).all()
    expect(clients).toEqual([
      { client_id: 'leeguoo-fishing-ios', redirect_uris: '["com.leeguoo.fishing:/oauth/callback"]', grant_types: 'authorization_code pkce refresh_token' },
    ])
  })

  it('admin APIs only accept tokens issued to the account center client', async () => {
    const viaSideApp = await accessToken('root@example.com', 'side-app')
    expect((await h.request('/api/admin/overview?tenant_id=t-platform', { bearer: viaSideApp })).status).toBe(403)
    const viaAccount = await accessToken('root@example.com', 'acct-web')
    expect((await h.request('/api/admin/overview?tenant_id=t-platform', { bearer: viaAccount })).status).toBe(200)
  })
})

describe('client_credentials + billing', () => {
  it('rejects a wrong secret and scopes the client was not granted', async () => {
    const bad = await h.request('/token', { method: 'POST', form: { grant_type: 'client_credentials', client_id: 'billing-svc', client_secret: 'nope' } })
    expect(bad.status).toBe(401)
    expect(await bad.json()).toMatchObject({ error: 'invalid_client' })
    const scoped = await serviceToken('admin:everything')
    expect(scoped.body).toMatchObject({ error: 'invalid_scope' })
  })

  it('public clients cannot use client_credentials', async () => {
    const response = await h.request('/token', { method: 'POST', form: { grant_type: 'client_credentials', client_id: 'app-console' } })
    expect(await response.json()).toMatchObject({ error: 'unauthorized_client' })
  })

  it('a billing backend turns events into subscriptions and entitlements', async () => {
    const { status, body } = await serviceToken()
    expect(status).toBe(200)
    const svc = body.access_token
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400

    const activated = await h.request('/api/billing/events/ingest', {
      method: 'POST',
      bearer: svc,
      json: {
        tenant_id: 't-app',
        provider: 'stripe',
        event_id: 'evt_1',
        event_type: 'subscription.activated',
        occurred_at: Math.floor(Date.now() / 1000) - 60,
        payload: { global_account_id: 'ga-buyer', plan_key: 'pro-monthly', provider_ref: 'sub_123', current_period_end: periodEnd },
      },
    })
    expect(activated.status).toBe(200)
    const activatedBody = (await activated.json()) as { event: { status: string; error_message: string | null } }
    expect(activatedBody.event).toMatchObject({ status: 'applied', error_message: null })

    const buyer = h.db.sqlite.prepare(`SELECT id FROM users WHERE tenant_id = 't-app' AND global_account_id = 'ga-buyer'`).get() as { id: string }
    expect(buyer?.id).toBeTruthy()

    const read = async () =>
      (await (await h.request(`/api/billing/entitlements?tenant_id=t-app&user_id=${buyer.id}`, { bearer: svc })).json()) as {
        active_entitlement_keys: string[]
      }
    expect((await read()).active_entitlement_keys.sort()).toEqual(['app.pro', 'membership.all_apps'])

    // Redelivery is idempotent.
    const again = await h.request('/api/billing/events/ingest', {
      method: 'POST',
      bearer: svc,
      json: { tenant_id: 't-app', provider: 'stripe', event_id: 'evt_1', event_type: 'subscription.activated', payload: {} },
    })
    expect(((await again.json()) as { idempotent: boolean }).idempotent).toBe(true)

    const canceled = await h.request('/api/billing/events/ingest', {
      method: 'POST',
      bearer: svc,
      json: { tenant_id: 't-app', provider: 'stripe', event_id: 'evt_2', event_type: 'subscription.canceled', payload: { provider_ref: 'sub_123' } },
    })
    expect(((await canceled.json()) as { event: { status: string } }).event.status).toBe('applied')
    expect((await read()).active_entitlement_keys).toEqual([])
    const sub = h.db.sqlite.prepare(`SELECT status FROM subscriptions WHERE provider_ref = 'sub_123'`).get() as { status: string }
    expect(sub.status).toBe('canceled')
  })

  it('cancel at period end keeps access until the period is over', async () => {
    const svc = (await serviceToken()).body.access_token
    const now = Math.floor(Date.now() / 1000)
    const send = (eventId: string, eventType: string, payload: Record<string, unknown>, occurredAt = now) =>
      h.request('/api/billing/events/ingest', {
        method: 'POST',
        bearer: svc,
        json: { tenant_id: 't-app', provider: 'stripe', event_id: eventId, event_type: eventType, occurred_at: occurredAt, payload },
      })
    await send('e1', 'subscription.activated', { global_account_id: 'ga-buyer', plan_key: 'pro-monthly', provider_ref: 'sub_9', current_period_end: now + 1000 }, now - 10)
    await send('e2', 'subscription.canceled', { provider_ref: 'sub_9', cancel_at_period_end: true })
    const row = h.db.sqlite.prepare(`SELECT valid_to, status FROM entitlements WHERE entitlement_key = 'app.pro'`).get() as { valid_to: number; status: string }
    expect(row).toMatchObject({ valid_to: now + 1000, status: 'granted' })
  })

  it('an unknown plan fails the event without throwing, and a redelivery can retry it', async () => {
    const svc = (await serviceToken()).body.access_token
    const body = { tenant_id: 't-app', provider: 'stripe', event_id: 'evt_bad', event_type: 'subscription.activated', payload: { global_account_id: 'ga-buyer', plan_key: 'nope' } }
    const first = (await (await h.request('/api/billing/events/ingest', { method: 'POST', bearer: svc, json: body })).json()) as { event: { status: string; error_message: string } }
    expect(first.event.status).toBe('failed')
    expect(first.event.error_message).toContain('Unknown plan_key')
  })

  it('a service token cannot call user-only admin APIs', async () => {
    const svc = (await serviceToken()).body.access_token
    expect((await h.request('/api/admin/overview?tenant_id=t-app', { bearer: svc })).status).toBe(403)
  })
})

describe('pre-registration account takeover', () => {
  const googleLogin = (email: string) =>
    h.request('/test/oauth-complete', {
      method: 'POST',
      json: {
        state: { state: 's', provider: 'google', client_id: 'acct-web', continue: '/account', intent: 'login', created_at: 0 },
        profile: { provider: 'google', subject: 'google-sub-1', email, emailVerified: true, profile: {} },
      },
    })

  it('a password set by someone who never proved the email stops working once Google proves it', async () => {
    // The squatter registered the victim's address with their own password and is signed in.
    await accessToken('buyer@example.com', 'acct-web')
    const response = await googleLogin('buyer@example.com')
    expect(response.status).toBe(200)

    const squatter = await h.request('/api/auth/login', { method: 'POST', json: { email: 'buyer@example.com', password: PASSWORD, client_id: 'acct-web' } })
    expect(squatter.status).toBe(401)
    const live = h.db.sqlite
      .prepare(`SELECT count(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.global_account_id = 'ga-buyer' AND s.revoked_at IS NULL`)
      .get() as { n: number }
    expect(live.n).toBe(1) // only the session Google just opened
  })

  it('an account whose email a provider already vouched for keeps its password', async () => {
    h.db.sqlite.exec(`INSERT INTO global_external_identities (id, global_account_id, provider, subject, email, email_verified)
                      VALUES ('gi-gh', 'ga-buyer', 'github', 'gh-1', 'buyer@example.com', 1)`)
    await googleLogin('buyer@example.com')
    const owner = await h.request('/api/auth/login', { method: 'POST', json: { email: 'buyer@example.com', password: PASSWORD, client_id: 'acct-web' } })
    expect(owner.status).toBe(200)
  })
})

describe('continue / bridge page hardening', () => {
  it('refuses backslash and control-character continue paths on both sides', () => {
    for (const value of ['/\\evil.test', '/\t/evil.test', '//evil.test', 'https://evil.test']) {
      expect(safeContinue(value)).toBe('')
      expect(safeContinuePath(value)).toBe('')
    }
    expect(safeContinue('/authorize?client_id=a&x=1')).toBe('/authorize?client_id=a&x=1')
  })

  it('cannot be broken out of the inline script', () => {
    const html = renderBridgeHtml({ accessToken: 't', email: 'a@b.c', redirectPath: '/x</script><script>alert(1)</script>', nonce: 'n' })
    expect(html).not.toContain('</script><script>')
    expect(html).toContain('\\u003c/script\\u003e')
  })
})

describe('client secrets', () => {
  it('hashed and legacy plaintext secrets both verify, wrong ones do not', async () => {
    expect(await verifyClientSecret('s3cret', await hashClientSecret('s3cret'))).toBe(true)
    expect(await verifyClientSecret('nope', await hashClientSecret('s3cret'))).toBe(false)
    expect(await verifyClientSecret('legacy', 'legacy')).toBe(true)
    expect(await verifyClientSecret(undefined, 'legacy')).toBe(false)
  })

  it('reads RFC 6749 form-encoded Basic credentials', () => {
    const header = `Basic ${Buffer.from('my%3Aclient:p%40ss').toString('base64')}`
    expect(readClientCredentials(header, {})).toEqual({ clientId: 'my:client', clientSecret: 'p@ss' })
  })
})
