import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import webhooksList from '../../server/routes/api/admin/webhooks/index.get'
import webhooksManage from '../../server/routes/api/admin/webhooks/index.post'
import deliveriesList from '../../server/routes/api/admin/webhooks/deliveries.get'
import deliveriesRetry from '../../server/routes/api/admin/webhooks/deliveries.post'
import accountAction from '../../server/routes/api/admin/accounts/[id].post'
import { defineEventHandler } from 'h3'
import { hashPassword } from '../../server/utils/crypto'
import { retryDueDeliveries, signWebhookBody } from '../../server/utils/webhooks'
import { createHarness } from '../helpers/harness'

const retry = defineEventHandler((event) => retryDueDeliveries(event))

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/admin/webhooks', handler: webhooksList },
  { method: 'post' as const, path: '/api/admin/webhooks', handler: webhooksManage },
  { method: 'get' as const, path: '/api/admin/webhooks/deliveries', handler: deliveriesList },
  { method: 'post' as const, path: '/api/admin/webhooks/deliveries', handler: deliveriesRetry },
  { method: 'post' as const, path: '/api/admin/accounts/:id', handler: accountAction },
  { method: 'post' as const, path: '/test/retry', handler: retry },
]

const PASSWORD = 'correct horse battery'
let h: Awaited<ReturnType<typeof createHarness>>
type Sent = { url: string; headers: Headers; body: string }
let sent: Sent[] = []
let reply = 200

beforeEach(async () => {
  sent = []
  reply = 200
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, headers: new Headers(init.headers), body: String(init.body) })
    return new Response('{}', { status: reply })
  })
  h = await createHarness(ROUTES, { DEFAULT_CLIENT_ID: 'acct-web', ADMIN_CLIENT_IDS: 'app-console', MFA_SECRET_KEY: 'test-key' })
  const hash = await hashPassword(PASSWORD, 'pepper')
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t-platform', 'Platform'), ('t-app', 'App'), ('t-other', 'Other');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't-platform', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email'),
             ('c-app', 't-app', 'app-console', 'App', '["https://app.test/cb"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-root', 't-platform', 'admin'), ('r-app', 't-app', 'admin');
  `)
  for (const [ga, email] of [['ga-root', 'root@example.com'], ['ga-app', 'appadmin@example.com'], ['ga-user', 'user@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(ga, email, hash)
  }
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES
      ('u-root', 't-platform', 'ga-root', 'root@example.com'),
      ('u-app', 't-app', 'ga-app', 'appadmin@example.com'),
      ('u-user-app', 't-app', 'ga-user', 'user@example.com'),
      ('u-user-other', 't-other', 'ga-user', 'user@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-root', 'r-root'), ('ur2', 'u-app', 'r-app');
  `)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const tokenFor = async (email: string, clientId: string) =>
  ((await (await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: clientId } })).json()) as { access_token: string }).access_token

const createEndpoint = async (bearer: string, extra: Record<string, unknown> = {}) => {
  const response = await h.request('/api/admin/webhooks', {
    method: 'POST',
    bearer,
    json: { tenant_id: 't-app', action: 'create', url: 'https://hooks.app.test/sso', events: ['account.suspended'], ...extra },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { endpoint: { id: string; events: string[] }; secret: string }
}

describe('webhook endpoints', () => {
  it('a tenant admin creates an endpoint; the secret is shown once and never listed', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    const { endpoint, secret } = await createEndpoint(admin)
    expect(secret).toMatch(/^whsec_/)
    expect(endpoint.events).toEqual(['account.suspended'])
    const list = await (await h.request('/api/admin/webhooks?tenant_id=t-app', { bearer: admin })).text()
    expect(list).not.toContain(secret)
    expect(list).not.toContain('secret_sealed')
    const sealed = (h.db.sqlite.prepare(`SELECT secret_sealed FROM webhook_endpoints`).get() as { secret_sealed: string }).secret_sealed
    expect(sealed).not.toContain(secret)
  })

  it('refuses non-https, private and credentialed URLs and unknown events', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    for (const url of ['http://hooks.app.test/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://u:p@hooks.app.test/x']) {
      const response = await h.request('/api/admin/webhooks', { method: 'POST', bearer: admin, json: { tenant_id: 't-app', action: 'create', url } })
      expect(response.status).toBe(400)
    }
    const bad = await h.request('/api/admin/webhooks', { method: 'POST', bearer: admin, json: { tenant_id: 't-app', action: 'create', url: 'https://hooks.app.test/x', events: ['nope'] } })
    expect(bad.status).toBe(400)
  })

  it('suspending an account sends a signed event with that app’s sub, only to subscribed tenants', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    const { secret } = await createEndpoint(admin)
    const root = await tokenFor('root@example.com', 'acct-web')
    expect((await h.request('/api/admin/accounts/ga-user', { method: 'POST', bearer: root, json: { action: 'suspend' } })).status).toBe(200)

    expect(sent).toHaveLength(1)
    const [delivery] = sent
    expect(delivery.url).toBe('https://hooks.app.test/sso')
    expect(delivery.headers.get('x-leeguoo-event')).toBe('account.suspended')
    const body = JSON.parse(delivery.body) as { type: string; tenant_id: string; data: { sub: string; global_account_id: string } }
    expect(body).toMatchObject({ type: 'account.suspended', tenant_id: 't-app', data: { sub: 'u-user-app', global_account_id: 'ga-user' } })
    const signature = delivery.headers.get('x-leeguoo-signature') || ''
    const t = Number(/t=(\d+)/.exec(signature)?.[1])
    expect(signature).toBe(await signWebhookBody(secret, t, delivery.body))

    // Not subscribed to account.restored: nothing sent.
    await h.request('/api/admin/accounts/ga-user', { method: 'POST', bearer: root, json: { action: 'restore' } })
    expect(sent).toHaveLength(1)
  })

  it('failed deliveries wait for a retry, and the retry sweep delivers them later', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    const { endpoint } = await createEndpoint(admin, { events: '*' })
    reply = 500
    const ping = (await (await h.request('/api/admin/webhooks', { method: 'POST', bearer: admin, json: { tenant_id: 't-app', action: 'test', endpoint_id: endpoint.id } })).json()) as { delivery_id: string }
    const row = h.db.sqlite.prepare(`SELECT status, attempts, last_status, next_attempt_at FROM webhook_deliveries WHERE id = ?`).get(ping.delivery_id) as Record<string, number | string>
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_status: 500 })
    expect(Number(row.next_attempt_at)).toBeGreaterThan(Math.floor(Date.now() / 1000))

    reply = 200
    h.db.sqlite.exec(`UPDATE webhook_deliveries SET next_attempt_at = 0`)
    const swept = (await (await h.request('/test/retry', { method: 'POST' })).json()) as { attempted: number; succeeded: number }
    expect(swept).toEqual({ attempted: 1, succeeded: 1 })
    const deliveries = (await (await h.request('/api/admin/webhooks/deliveries?tenant_id=t-app', { bearer: admin })).json()) as { deliveries: { status: string; attempts: number; payload: { type: string } }[] }
    expect(deliveries.deliveries[0]).toMatchObject({ status: 'succeeded', attempts: 2, payload: { type: 'webhook.ping' } })
  })

  it('disabled endpoints get nothing; deleting removes its history', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    const { endpoint } = await createEndpoint(admin)
    await h.request('/api/admin/webhooks', { method: 'POST', bearer: admin, json: { tenant_id: 't-app', action: 'disable', endpoint_id: endpoint.id } })
    const root = await tokenFor('root@example.com', 'acct-web')
    await h.request('/api/admin/accounts/ga-user', { method: 'POST', bearer: root, json: { action: 'suspend' } })
    expect(sent).toHaveLength(0)
    const del = await h.request('/api/admin/webhooks', { method: 'POST', bearer: admin, json: { tenant_id: 't-app', action: 'delete', endpoint_id: endpoint.id } })
    expect(del.status).toBe(200)
    expect(h.db.sqlite.prepare(`SELECT count(*) AS n FROM webhook_endpoints`).get()).toEqual({ n: 0 })
  })

  it('tenant admins cannot touch another tenant’s endpoints', async () => {
    const admin = await tokenFor('appadmin@example.com', 'app-console')
    const other = await h.request('/api/admin/webhooks', {
      method: 'POST',
      bearer: admin,
      json: { tenant_id: 't-other', action: 'create', url: 'https://hooks.other.test/x' },
    })
    expect(other.status).toBe(403)
  })
})
