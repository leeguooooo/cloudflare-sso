import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import login from '../../server/routes/api/auth/login.post'
import entitlements from '../../server/routes/api/billing/entitlements.get'
import webhook from '../../server/routes/api/billing/afdian/webhook.post'
import checkout from '../../server/routes/api/billing/afdian/checkout.post'
import membership from '../../server/routes/api/billing/afdian/membership.get'
import adminOrders from '../../server/routes/api/admin/afdian/orders.get'
import adminBind from '../../server/routes/api/admin/afdian/orders.post'
import reconcile from '../../server/routes/api/internal/billing/reconcile.post'
import { hashPassword } from '../../server/utils/crypto'
import { md5Hex } from '../../server/utils/md5'
import { verifyAfdianSignature, type AfdianOrder } from '../../server/utils/afdian'
import { cookieFrom, createHarness } from '../helpers/harness'

const ROUTES = [
  { method: 'post' as const, path: '/api/auth/login', handler: login },
  { method: 'get' as const, path: '/api/billing/entitlements', handler: entitlements },
  { method: 'post' as const, path: '/api/billing/afdian/webhook', handler: webhook },
  { method: 'post' as const, path: '/api/billing/afdian/checkout', handler: checkout },
  { method: 'get' as const, path: '/api/billing/afdian/membership', handler: membership },
  { method: 'get' as const, path: '/api/admin/afdian/orders', handler: adminOrders },
  { method: 'post' as const, path: '/api/admin/afdian/orders', handler: adminBind },
  { method: 'post' as const, path: '/api/internal/billing/reconcile', handler: reconcile },
]

const PASSWORD = 'correct horse battery'
const DAY = 86400
const PLANS = JSON.stringify({
  'plan-jr': { app_key: 'jrkan', tenant_id: 'tenant-jrkan', entitlement_key: 'jrkan.premium', days_per_month: 31, price_label: '¥1.99/月', name: 'JRKAN 会员' },
})

let keys: CryptoKeyPair
let publicPem = ''
let h: Awaited<ReturnType<typeof createHarness>>

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64').replace(/(.{64})/g, '$1\n')
  publicPem = `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----`
})

const setup = async (env: Record<string, string> = {}) => {
  h = await createHarness(ROUTES, {
    AFDIAN_PLANS: PLANS,
    AFDIAN_PUBLIC_KEY: publicPem,
    AFDIAN_USER_ID: 'creator-1',
    TENANT_SIGNUP_TRIALS: '{"tenant-jrkan":{"entitlement_key":"jrkan.premium","days":90}}',
    RECONCILE_SECRET: 'reconcile-secret',
    ...env,
  })
  h.db.sqlite.exec(readFileSync(new URL('../../scripts/sql/jrkan-clients.sql', import.meta.url), 'utf8'))
  h.db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('t1', 'Platform');
    INSERT INTO clients (id, tenant_id, client_id, name, redirect_uris, grant_types, scope)
      VALUES ('c-acct', 't1', 'acct-web', 'Account', '["https://sso.test/"]', 'authorization_code pkce refresh_token', 'openid profile email');
    INSERT INTO roles (id, tenant_id, name) VALUES ('r-admin', 't1', 'admin');
  `)
  const hash = await hashPassword(PASSWORD, 'pepper')
  for (const [id, email] of [['ga1', 'fan@example.com'], ['ga2', 'new@example.com'], ['ga-admin', 'admin@example.com']]) {
    h.db.sqlite.prepare(`INSERT INTO global_accounts (id, email, password_hash) VALUES (?, ?, ?)`).run(id, email, hash)
  }
  h.db.sqlite.exec(`
    INSERT INTO users (id, tenant_id, global_account_id, email) VALUES ('u-admin', 't1', 'ga-admin', 'admin@example.com');
    INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur1', 'u-admin', 'r-admin');
  `)
}

beforeEach(() => setup())
afterEach(() => vi.unstubAllGlobals())

const signIn = async (email: string, clientId: string) => {
  const response = await h.request('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD, client_id: clientId } })
  expect(response.status).toBe(200)
  return { cookie: cookieFrom(response, 'sso_refresh_token'), token: ((await response.json()) as { access_token: string }).access_token }
}

const sign = async (order: AfdianOrder) => {
  const message = `${order.out_trade_no}${order.user_id}${order.plan_id}${order.total_amount}`
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keys.privateKey, new TextEncoder().encode(message))
  return Buffer.from(signature).toString('base64')
}

const paidOrder = (over: Partial<AfdianOrder> = {}): AfdianOrder => ({
  out_trade_no: `2026100612${Math.floor(Math.random() * 1e8)}`,
  custom_order_id: '',
  user_id: 'afd-user-1',
  plan_id: 'plan-jr',
  month: 1,
  total_amount: '1.99',
  show_amount: '1.99',
  status: 2,
  remark: '',
  ...over,
})

const push = async (order: AfdianOrder, signature?: string) => {
  const response = await h.request('/api/billing/afdian/webhook', {
    method: 'POST',
    json: { ec: 200, em: 'ok', data: { type: 'order', order, sign: signature ?? (await sign(order)) } },
  })
  return { status: response.status, body: (await response.json()) as { ec: number; em: string } }
}

const startCheckout = async (cookie: string, body: Record<string, unknown> = { app_key: 'jrkan', month: 1 }, headers: Record<string, string> = {}) => {
  const response = await h.request('/api/billing/afdian/checkout', { method: 'POST', cookie, headers, json: body })
  return { status: response.status, body: (await response.json()) as Record<string, string> }
}

const premium = (gaid: string) =>
  h.db.sqlite
    .prepare(
      `SELECT e.id, e.source, e.valid_from, e.valid_to, e.meta_json FROM entitlements e JOIN users u ON u.id = e.user_id
       WHERE u.global_account_id = ? AND e.tenant_id = 'tenant-jrkan' AND e.entitlement_key = 'jrkan.premium' ORDER BY e.valid_to`,
    )
    .all(gaid) as Array<{ id: string; source: string; valid_from: number; valid_to: number; meta_json: string }>

const orderRow = (outTradeNo: string) =>
  h.db.sqlite.prepare(`SELECT status, reason, global_account_id, via FROM afdian_orders WHERE out_trade_no = ?`).get(outTradeNo) as
    | { status: string; reason: string | null; global_account_id: string | null; via: string }
    | undefined

describe('afdian helpers', () => {
  it('md5 matches afdian’s documented vector and node', () => {
    expect(md5Hex('123params{"a":333}ts1624339905user_idabc')).toBe('a4acc28b81598b7e5d84ebdc3e91710c')
    for (const value of ['', 'a', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), '中文'.repeat(40)]) {
      expect(md5Hex(value)).toBe(createHash('md5').update(value).digest('hex'))
    }
  })

  it('verifies RSA-SHA256 webhook signatures; afdian’s real key is the default', async () => {
    const order = paidOrder()
    const signature = await sign(order)
    expect(await verifyAfdianSignature(order, signature, publicPem)).toBe(true)
    expect(await verifyAfdianSignature({ ...order, total_amount: '0.01' }, signature, publicPem)).toBe(false)
    expect(await verifyAfdianSignature(order, signature)).toBe(false)
    expect(await verifyAfdianSignature(order, '', publicPem)).toBe(false)
  })
})

describe('membership checkout', () => {
  it('is "not available yet" without a plan for the app', async () => {
    await setup({ AFDIAN_PLANS: '' })
    const { cookie } = await signIn('fan@example.com', 'acct-web')
    const status = (await (await h.request('/api/billing/afdian/membership?app_key=jrkan', { cookie })).json()) as Record<string, unknown>
    expect(status).toMatchObject({ signed_in: true, email: 'fan@example.com', available: false, status: 'none' })
    const started = await startCheckout(cookie)
    expect(started.status).toBe(404)
    expect(started.body.error).toBe('not_available')
  })

  it('creates a checkout for the session account and returns the afdian order URL', async () => {
    const { cookie } = await signIn('fan@example.com', 'acct-web')
    const started = await startCheckout(cookie, { app_key: 'jrkan', month: 3 })
    expect(started.status).toBe(200)
    const url = new URL(started.body.url)
    expect(url.origin + url.pathname).toBe('https://ifdian.net/order/create')
    expect(Object.fromEntries(url.searchParams)).toEqual({ plan_id: 'plan-jr', product_type: '0', month: '3', custom_order_id: started.body.checkout_id })
    expect(h.db.sqlite.prepare(`SELECT global_account_id, tenant_id, month FROM afdian_checkouts`).get()).toEqual({ global_account_id: 'ga1', tenant_id: 'tenant-jrkan', month: 3 })

    expect((await startCheckout('')).status).toBe(401)
    expect((await startCheckout(cookie, { app_key: 'jrkan', month: 13 })).status).toBe(400)
    expect((await startCheckout(cookie, { app_key: 'jrkan', month: 1 }, { origin: 'https://evil.example' })).status).toBe(403)
    const anonymous = (await (await h.request('/api/billing/afdian/membership?app_key=jrkan')).json()) as Record<string, unknown>
    expect(anonymous).toMatchObject({ signed_in: false, available: true, price_label: '¥1.99/月', name: 'JRKAN 会员' })
  })
})

describe('afdian webhook', () => {
  it('matches by checkout, stacks on top of the trial, then renews by afdian user binding', async () => {
    await signIn('fan@example.com', 'leeguoo-jrkan-ios') // 90-day trial
    const [trial] = premium('ga1')
    const { cookie } = await signIn('fan@example.com', 'acct-web')
    const started = await startCheckout(cookie)

    const first = paidOrder({ custom_order_id: started.body.checkout_id })
    expect(await push(first)).toEqual({ status: 200, body: { ec: 200, em: '' } })
    expect(orderRow(first.out_trade_no)).toMatchObject({ status: 'matched', global_account_id: 'ga1', via: 'webhook' })
    const afterFirst = premium('ga1')
    expect(afterFirst).toHaveLength(2)
    const paid = afterFirst.find((row) => row.source === 'plan')!
    expect(paid.valid_to).toBe(trial.valid_to + 31 * DAY)
    expect(JSON.parse(paid.meta_json)).toMatchObject({ provider: 'afdian' })
    expect(h.db.sqlite.prepare(`SELECT global_account_id FROM afdian_bindings WHERE afdian_user_id = 'afd-user-1'`).get()).toEqual({ global_account_id: 'ga1' })
    expect(h.db.sqlite.prepare(`SELECT consumed_order FROM afdian_checkouts`).get()).toEqual({ consumed_order: first.out_trade_no })

    // Auto-renewal: no custom_order_id, matched through the afdian user id; 2 months.
    const renewal = paidOrder({ month: 2, total_amount: '3.98' })
    expect((await push(renewal)).body.ec).toBe(200)
    const afterRenewal = premium('ga1').filter((row) => row.source === 'plan')
    expect(afterRenewal).toHaveLength(1)
    expect(afterRenewal[0].valid_to).toBe(paid.valid_to + 62 * DAY)

    // afdian re-pushes: applied once.
    expect((await push(renewal)).body.ec).toBe(200)
    expect(premium('ga1').find((row) => row.source === 'plan')!.valid_to).toBe(paid.valid_to + 62 * DAY)

    const status = (await (await h.request('/api/billing/afdian/membership?app_key=jrkan', { cookie })).json()) as Record<string, unknown>
    expect(status).toMatchObject({ status: 'member', valid_to: paid.valid_to + 62 * DAY })

    const { token } = await signIn('fan@example.com', 'leeguoo-jrkan-tv')
    const body = (await (await h.request('/api/billing/entitlements', { bearer: token })).json()) as { entitlements: Array<Record<string, unknown>> }
    expect(body.entitlements.map((row) => [row.source, row.trial, row.provider]).sort()).toEqual([
      ['plan', false, 'afdian'],
      ['promo', true, null],
    ])
  })

  it('provisions the tenant user for an account that never opened the app', async () => {
    const { cookie } = await signIn('new@example.com', 'acct-web')
    const started = await startCheckout(cookie)
    const order = paidOrder({ custom_order_id: started.body.checkout_id, user_id: 'afd-new' })
    expect((await push(order)).body.ec).toBe(200)
    const [row] = premium('ga2')
    expect(row.source).toBe('plan')
    expect(row.valid_to - row.valid_from).toBe(31 * DAY)
  })

  it('keeps unmatched orders for an admin, who can bind them', async () => {
    const order = paidOrder({ user_id: 'afd-stranger' })
    expect(await push(order)).toEqual({ status: 200, body: { ec: 200, em: '' } })
    expect(orderRow(order.out_trade_no)).toMatchObject({ status: 'unmatched', reason: 'no_account' })

    const { token } = await signIn('admin@example.com', 'acct-web')
    const listed = (await (await h.request('/api/admin/afdian/orders?status=unmatched', { bearer: token })).json()) as { orders: Array<Record<string, unknown>> }
    expect(listed.orders).toHaveLength(1)
    expect(listed.orders[0]).toMatchObject({ out_trade_no: order.out_trade_no, afdian_user_id: 'afd-stranger', order: { total_amount: '1.99' } })

    const { token: fanToken } = await signIn('fan@example.com', 'acct-web')
    expect((await h.request('/api/admin/afdian/orders', { bearer: fanToken })).status).toBe(403)

    const bound = await h.request('/api/admin/afdian/orders', { method: 'POST', bearer: token, json: { out_trade_no: order.out_trade_no, email: 'fan@example.com' } })
    expect(await bound.json()).toMatchObject({ status: 'matched', global_account_id: 'ga1' })
    expect(orderRow(order.out_trade_no)).toMatchObject({ status: 'matched', via: 'admin' })
    expect(h.db.sqlite.prepare(`SELECT global_account_id FROM afdian_bindings WHERE afdian_user_id = 'afd-stranger'`).get()).toEqual({ global_account_id: 'ga1' })
    expect((await h.request('/api/admin/afdian/orders', { method: 'POST', bearer: token, json: { out_trade_no: order.out_trade_no, email: 'fan@example.com' } })).status).toBe(409)
  })

  it('answers ec 200 to bad or missing signatures but records and grants nothing', async () => {
    await signIn('fan@example.com', 'acct-web')
    h.db.sqlite.exec(`INSERT INTO afdian_bindings (afdian_user_id, global_account_id, bound_at) VALUES ('afd-user-1', 'ga1', 1)`)
    const order = paidOrder()
    expect(await push({ ...order, total_amount: '0.01' }, await sign(order))).toEqual({ status: 200, body: { ec: 200, em: '' } })
    expect(await push(order, '')).toEqual({ status: 200, body: { ec: 200, em: '' } })
    expect(orderRow(order.out_trade_no)).toBeUndefined()
    expect(premium('ga1')).toEqual([])
  })

  it('records unknown plans as rejected', async () => {

    const unknownPlan = paidOrder({ plan_id: 'plan-other' })
    expect((await push(unknownPlan)).body.ec).toBe(200)
    expect(orderRow(unknownPlan.out_trade_no)).toMatchObject({ status: 'rejected', reason: 'unknown_plan' })
  })

  it('with AFDIAN_TOKEN, confirms orders through the open API and reconcile picks up missed ones', async () => {
    await setup({ AFDIAN_TOKEN: 'tok' })
    await signIn('fan@example.com', 'acct-web')
    h.db.sqlite.exec(`INSERT INTO afdian_bindings (afdian_user_id, global_account_id, bound_at) VALUES ('afd-user-1', 'ga1', 1)`)
    const remote: AfdianOrder[] = []
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://ifdian.net/api/open/query-order')
      const body = JSON.parse(String(init?.body)) as { user_id: string; params: string; ts: number; sign: string }
      calls.push(body)
      expect(body.sign).toBe(md5Hex(`tokparams${body.params}ts${body.ts}user_idcreator-1`))
      const params = JSON.parse(body.params) as { out_trade_no?: string }
      const list = params.out_trade_no ? remote.filter((o) => o.out_trade_no === params.out_trade_no) : remote
      return new Response(JSON.stringify({ ec: 200, em: 'ok', data: { list, total_page: 1 } }))
    })

    const order = paidOrder()
    expect((await push(order)).body.ec).toBe(500) // not visible through the API yet → afdian retries
    remote.push(order)
    expect((await push(order)).body.ec).toBe(200)
    expect(orderRow(order.out_trade_no)?.status).toBe('matched')

    const cheap = paidOrder()
    remote.push({ ...cheap, total_amount: '0.01' })
    expect((await push(cheap)).body.ec).toBe(200)
    expect(orderRow(cheap.out_trade_no)).toMatchObject({ status: 'rejected', reason: 'api_mismatch' })

    // A paid order afdian never pushed: the reconcile run applies it.
    const missed = paidOrder()
    remote.push(missed)
    const run = await h.request('/api/internal/billing/reconcile', { method: 'POST', bearer: 'reconcile-secret' })
    expect(await run.json()).toMatchObject({ afdian: { matched: 1, unmatched: 0 } })
    expect(orderRow(missed.out_trade_no)).toMatchObject({ status: 'matched', via: 'reconcile' })
    expect(calls.some((call) => JSON.parse(String(call.params)).page === 1)).toBe(true)
  })
})

describe('entitlements response', () => {
  it('lists the latest lapsed grant of keys the user no longer has', async () => {
    const { token } = await signIn('fan@example.com', 'leeguoo-jrkan-ios')
    h.db.sqlite.exec(`UPDATE entitlements SET valid_from = 1000, valid_to = 2000`)
    const body = (await (await h.request('/api/billing/entitlements', { bearer: token })).json()) as Record<string, unknown>
    expect(body.active_entitlement_keys).toEqual([])
    expect(body.entitlements).toEqual([])
    expect(body.expired_entitlements).toEqual([{ entitlement_key: 'jrkan.premium', source: 'promo', valid_to: 2000, trial: true, provider: null }])
  })
})
