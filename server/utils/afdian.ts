/**
 * Paid memberships through 爱发电 (afdian, ifdian.net).
 *
 * AFDIAN_PLANS maps an afdian plan_id to the entitlement it extends:
 *   '{"<plan_id>":{"app_key":"jrkan","tenant_id":"tenant-jrkan","entitlement_key":"jrkan.premium",
 *     "days_per_month":31,"price_label":"¥1.99/月","name":"JRKAN 会员"}}'
 *
 * - /membership/<app_key> creates an `afdian_checkouts` row for the signed-in account and sends
 *   the user to afdian with custom_order_id = that row's id.
 * - afdian pushes paid orders to the webhook (RSA-SHA256 signed). An order is matched to an
 *   account by custom_order_id, or else by the afdian user id remembered in `afdian_bindings`
 *   from an earlier matched order (auto-renewals and later purchases carry no custom_order_id).
 * - Every order lands in `afdian_orders` (matched / unmatched / rejected) keyed by out_trade_no;
 *   an order is applied at most once. Unmatched orders wait there for an admin.
 * - With AFDIAN_TOKEN set, webhook orders are confirmed through the open API and the billing
 *   reconcile run pulls recent orders, so a missed webhook is picked up within 30 minutes.
 *
 * A paid month extends the entitlement from max(now, its latest current end — the trial
 * included) by month × days_per_month days. The row has source 'plan', no subscription and
 * meta_json {"provider":"afdian"}.
 */
import { H3Event } from 'h3'
import { base64UrlDecode, nowInSeconds } from './crypto'
import { ensureBillingSchema } from './billing'
import { getDb, getEnv } from './env'
import { findGlobalAccountById, findTenantUserByGlobalAccount, provisionTenantUserForGlobalAccount } from './identity'
import { md5Hex } from './md5'
import { oncePerDb } from './schema-once'

export const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`

const DEFAULT_API_BASE = 'https://ifdian.net'
/** An order stuck in `processing` this long (crashed request) may be picked up again. */
const STALE_PROCESSING_SECONDS = 300

type EnvLike = ReturnType<typeof getEnv>

export type AfdianPlan = {
  plan_id: string
  app_key: string
  tenant_id: string
  entitlement_key: string
  days_per_month: number
  price_label: string
  name: string
}

export type AfdianOrder = {
  out_trade_no: string
  custom_order_id?: string
  user_id: string
  user_private_id?: string
  plan_id: string
  month: number | string
  total_amount: string
  show_amount?: string
  status: number | string
  remark?: string
  [key: string]: unknown
}

export type OrderOutcome = {
  status: 'matched' | 'unmatched' | 'rejected' | 'duplicate'
  reason?: string
  global_account_id?: string
  valid_to?: number
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

export const readAfdianPlans = (env: EnvLike): AfdianPlan[] => {
  const raw = (env.AFDIAN_PLANS || '').trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('afdian_plans is not valid json')
    return []
  }
  const plans: AfdianPlan[] = []
  for (const [planId, value] of Object.entries((parsed || {}) as Record<string, Record<string, unknown>>)) {
    const plan = {
      plan_id: planId.trim(),
      app_key: str(value?.app_key).toLowerCase(),
      tenant_id: str(value?.tenant_id),
      entitlement_key: str(value?.entitlement_key),
      days_per_month: Number(value?.days_per_month || 31),
      price_label: str(value?.price_label),
      name: str(value?.name),
    }
    if (plan.plan_id && plan.app_key && plan.tenant_id && plan.entitlement_key && plan.days_per_month > 0) plans.push(plan)
  }
  return plans
}

export const afdianPlanForApp = (env: EnvLike, appKey: string) => readAfdianPlans(env).find((plan) => plan.app_key === appKey.trim().toLowerCase())

export const afdianPlanById = (env: EnvLike, planId: string) => readAfdianPlans(env).find((plan) => plan.plan_id === planId)

export const afdianCheckoutUrl = (planId: string, month: number, customOrderId: string) => {
  const url = new URL('https://ifdian.net/order/create')
  url.searchParams.set('plan_id', planId)
  url.searchParams.set('product_type', '0')
  url.searchParams.set('month', String(month))
  url.searchParams.set('custom_order_id', customOrderId)
  return url.toString()
}

// ---------------------------------------------------------------------------
// Webhook signature (RSA-SHA256 over out_trade_no + user_id + plan_id + total_amount)
// ---------------------------------------------------------------------------

const keyCache = new Map<string, Promise<CryptoKey>>()

const importPublicKey = (pem: string) => {
  let key = keyCache.get(pem)
  if (!key) {
    const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')
    const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
    key = crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    keyCache.set(pem, key)
  }
  return key
}

/** AFDIAN_PUBLIC_KEY overrides afdian's published key (tests, or if afdian ever rotates it). */
export const verifyAfdianSignature = async (order: AfdianOrder, sign: string, publicKeyPem = AFDIAN_PUBLIC_KEY) => {
  if (!sign) return false
  try {
    const key = await importPublicKey(publicKeyPem)
    const message = `${str(order.out_trade_no)}${str(order.user_id)}${str(order.plan_id)}${str(order.total_amount)}`
    const signature = sign.includes('-') || sign.includes('_') ? base64UrlDecode(sign) : Uint8Array.from(atob(sign), (char) => char.charCodeAt(0))
    return await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, new TextEncoder().encode(message))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Open API
// ---------------------------------------------------------------------------

export const isAfdianApiConfigured = (env: EnvLike) => Boolean((env.AFDIAN_USER_ID || '').trim() && (env.AFDIAN_TOKEN || '').trim())

/** POST /api/open/query-order; params e.g. { out_trade_no: "a,b" } or { page: 1, per_page: 50 }. */
export const queryAfdianOrders = async (env: EnvLike, params: Record<string, unknown>) => {
  const userId = (env.AFDIAN_USER_ID || '').trim()
  const token = (env.AFDIAN_TOKEN || '').trim()
  if (!userId || !token) throw new Error('afdian api is not configured')
  const ts = nowInSeconds()
  const paramsJson = JSON.stringify(params)
  const sign = md5Hex(`${token}params${paramsJson}ts${ts}user_id${userId}`)
  const base = ((env.AFDIAN_API_BASE || '').trim() || DEFAULT_API_BASE).replace(/\/+$/, '')
  const response = await fetch(`${base}/api/open/query-order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ user_id: userId, params: paramsJson, ts, sign }),
  })
  const payload = (await response.json().catch(() => null)) as {
    ec?: number
    em?: string
    data?: { list?: AfdianOrder[]; total_page?: number }
  } | null
  if (!response.ok || payload?.ec !== 200) throw new Error(`afdian query-order failed: ${payload?.em || response.status}`)
  return { list: payload.data?.list || [], totalPage: Number(payload.data?.total_page || 1) }
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

const afdianSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS afdian_checkouts (
        id TEXT PRIMARY KEY,
        global_account_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        month INTEGER NOT NULL,
        consumed_order TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
      )`,
    )
    .run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS afdian_bindings (
        afdian_user_id TEXT PRIMARY KEY,
        global_account_id TEXT NOT NULL,
        bound_at INTEGER NOT NULL
      )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_afdian_bindings_account ON afdian_bindings (global_account_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS afdian_orders (
        out_trade_no TEXT PRIMARY KEY,
        plan_id TEXT,
        afdian_user_id TEXT,
        custom_order_id TEXT,
        month INTEGER,
        total_amount TEXT,
        status TEXT NOT NULL CHECK (status IN ('processing', 'matched', 'unmatched', 'rejected', 'error')),
        reason TEXT,
        global_account_id TEXT,
        tenant_id TEXT,
        user_id TEXT,
        entitlement_id TEXT,
        valid_to INTEGER,
        via TEXT,
        raw_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_afdian_orders_status ON afdian_orders (status, created_at DESC)`).run()
})

export const ensureAfdianSchema = async (event: H3Event) => {
  await ensureBillingSchema(event)
  await afdianSchema(getDb(event))
}

export const createAfdianCheckout = async (event: H3Event, input: { globalAccountId: string; plan: AfdianPlan; month: number }) => {
  await ensureAfdianSchema(event)
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await getDb(event)
    .prepare(`INSERT INTO afdian_checkouts (id, global_account_id, tenant_id, plan_id, month) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, input.globalAccountId, input.plan.tenant_id, input.plan.plan_id, input.month)
    .run()
  return { id, url: afdianCheckoutUrl(input.plan.plan_id, input.month, id) }
}

const recordOrder = async (event: H3Event, order: AfdianOrder, via: string, status: 'processing' | 'rejected', reason: string | null) => {
  const now = nowInSeconds()
  return getDb(event)
    .prepare(
      `INSERT OR IGNORE INTO afdian_orders
         (out_trade_no, plan_id, afdian_user_id, custom_order_id, month, total_amount, status, reason, via, raw_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      str(order.out_trade_no),
      str(order.plan_id) || null,
      str(order.user_id) || null,
      str(order.custom_order_id) || null,
      Math.floor(Number(order.month) || 0) || null,
      str(order.total_amount) || null,
      status,
      reason,
      via,
      JSON.stringify(order),
      now,
      now,
    )
    .run()
}

/** Keeps a refused order for the record (bad amount, unknown plan …) unless it was already applied. */
export const rejectAfdianOrder = async (event: H3Event, order: AfdianOrder, via: string, reason: string) => {
  await ensureAfdianSchema(event)
  const inserted = await recordOrder(event, order, via, 'rejected', reason)
  if (!inserted.meta?.changes) {
    await getDb(event)
      .prepare(`UPDATE afdian_orders SET status = 'rejected', reason = ?, updated_at = ? WHERE out_trade_no = ? AND status IN ('unmatched', 'error')`)
      .bind(reason, nowInSeconds(), str(order.out_trade_no))
      .run()
  }
}

export const findAfdianOrder = async (event: H3Event, outTradeNo: string) => {
  await ensureAfdianSchema(event)
  return getDb(event)
    .prepare(`SELECT * FROM afdian_orders WHERE out_trade_no = ?`)
    .bind(outTradeNo)
    .first<{ out_trade_no: string; status: string; raw_json: string; global_account_id: string | null; valid_to: number | null }>()
}

/**
 * Applies a paid afdian order at most once. The order must already be trusted: signature-checked
 * (webhook), fetched from the open API (reconcile), or picked by an admin (`globalAccountId`).
 */
export const processAfdianOrder = async (
  event: H3Event,
  order: AfdianOrder,
  options: { via: 'webhook' | 'reconcile' | 'admin'; globalAccountId?: string },
): Promise<OrderOutcome> => {
  await ensureAfdianSchema(event)
  const db = getDb(event)
  const env = getEnv(event)
  const outTradeNo = str(order.out_trade_no)
  if (!outTradeNo) return { status: 'rejected', reason: 'missing_out_trade_no' }
  const now = nowInSeconds()

  // Claim the order: new, or an earlier attempt that found no account / crashed.
  const inserted = await recordOrder(event, order, options.via, 'processing', null)
  if (!inserted.meta?.changes) {
    const claimed = await db
      .prepare(
        `UPDATE afdian_orders SET status = 'processing', via = ?, updated_at = ?
         WHERE out_trade_no = ? AND (status IN ('unmatched', 'error') OR (status = 'processing' AND updated_at < ?))`,
      )
      .bind(options.via, now, outTradeNo, now - STALE_PROCESSING_SECONDS)
      .run()
    if (!claimed.meta?.changes) {
      const existing = await findAfdianOrder(event, outTradeNo)
      return { status: 'duplicate', reason: existing?.status, global_account_id: existing?.global_account_id || undefined, valid_to: existing?.valid_to || undefined }
    }
  }

  const finish = async (status: 'unmatched' | 'rejected', reason: string): Promise<OrderOutcome> => {
    await db
      .prepare(`UPDATE afdian_orders SET status = ?, reason = ?, updated_at = ? WHERE out_trade_no = ?`)
      .bind(status, reason, nowInSeconds(), outTradeNo)
      .run()
    return { status, reason }
  }

  try {
    if (Number(order.status) !== 2) return await finish('rejected', 'not_paid')
    const plan = afdianPlanById(env, str(order.plan_id))
    if (!plan) return await finish('rejected', 'unknown_plan')
    const month = Math.min(Math.max(Math.floor(Number(order.month) || 1), 1), 120)

    let globalAccountId = options.globalAccountId || ''
    let checkoutId = ''
    const customOrderId = str(order.custom_order_id)
    if (!globalAccountId && customOrderId) {
      const checkout = await db
        .prepare(`SELECT id, global_account_id, tenant_id FROM afdian_checkouts WHERE id = ?`)
        .bind(customOrderId)
        .first<{ id: string; global_account_id: string; tenant_id: string }>()
      if (checkout && checkout.tenant_id === plan.tenant_id) {
        globalAccountId = checkout.global_account_id
        checkoutId = checkout.id
      }
    }
    const afdianUserId = str(order.user_id)
    if (!globalAccountId && afdianUserId) {
      const binding = await db
        .prepare(`SELECT global_account_id FROM afdian_bindings WHERE afdian_user_id = ?`)
        .bind(afdianUserId)
        .first<{ global_account_id: string }>()
      globalAccountId = binding?.global_account_id || ''
    }
    if (!globalAccountId) return await finish('unmatched', 'no_account')
    const account = await findGlobalAccountById(event, globalAccountId)
    if (!account) return await finish('unmatched', 'account_missing')

    const provisioned = await provisionTenantUserForGlobalAccount(event, {
      tenantId: plan.tenant_id,
      globalAccountId: account.id,
      email: account.email,
      locale: account.locale || 'en',
    })
    const userId = provisioned.user.id
    const current = await db
      .prepare(
        `SELECT max(valid_to) AS until FROM entitlements
         WHERE tenant_id = ? AND user_id = ? AND entitlement_key = ? AND status = 'granted' AND valid_to IS NOT NULL`,
      )
      .bind(plan.tenant_id, userId, plan.entitlement_key)
      .first<{ until: number | null }>()
    const validTo = Math.max(now, Number(current?.until || 0)) + month * plan.days_per_month * 86400
    // One running afdian row per user and key: renewals push its end out.
    const running = await db
      .prepare(
        `SELECT id FROM entitlements
         WHERE tenant_id = ? AND user_id = ? AND entitlement_key = ? AND source = 'plan' AND subscription_id IS NULL
           AND status = 'granted' AND valid_to >= ? AND json_extract(meta_json, '$.provider') = 'afdian'
         ORDER BY valid_to DESC LIMIT 1`,
      )
      .bind(plan.tenant_id, userId, plan.entitlement_key, now)
      .first<{ id: string }>()
    const entitlementId = running?.id || `afdian-${outTradeNo}`

    const statements = [
      running
        ? db.prepare(`UPDATE entitlements SET valid_to = ?, updated_at = ? WHERE id = ?`).bind(validTo, now, entitlementId)
        : db
            .prepare(
              `INSERT INTO entitlements (id, tenant_id, user_id, subscription_id, entitlement_key, source, status, valid_from, valid_to, meta_json)
               VALUES (?, ?, ?, NULL, ?, 'plan', 'granted', ?, ?, ?)`,
            )
            .bind(entitlementId, plan.tenant_id, userId, plan.entitlement_key, now, validTo, JSON.stringify({ provider: 'afdian', plan_id: plan.plan_id })),
      db
        .prepare(
          `UPDATE afdian_orders
           SET status = 'matched', reason = NULL, global_account_id = ?, tenant_id = ?, user_id = ?, entitlement_id = ?, valid_to = ?, updated_at = ?
           WHERE out_trade_no = ? AND status = 'processing'`,
        )
        .bind(account.id, plan.tenant_id, userId, entitlementId, validTo, now, outTradeNo),
    ]
    if (afdianUserId) {
      statements.push(
        db
          .prepare(
            `INSERT INTO afdian_bindings (afdian_user_id, global_account_id, bound_at) VALUES (?, ?, ?)
             ON CONFLICT (afdian_user_id) DO UPDATE SET global_account_id = excluded.global_account_id, bound_at = excluded.bound_at`,
          )
          .bind(afdianUserId, account.id, now),
      )
    }
    if (checkoutId) {
      statements.push(db.prepare(`UPDATE afdian_checkouts SET consumed_order = COALESCE(consumed_order, ?) WHERE id = ?`).bind(outTradeNo, checkoutId))
    }
    await db.batch(statements)
    return { status: 'matched', global_account_id: account.id, valid_to: validTo }
  } catch (error) {
    await db
      .prepare(`UPDATE afdian_orders SET status = 'error', reason = ?, updated_at = ? WHERE out_trade_no = ? AND status = 'processing'`)
      .bind(String((error as Error)?.message || error).slice(0, 300), nowInSeconds(), outTradeNo)
      .run()
      .catch(() => undefined)
    throw error
  }
}

/** Reconcile step: applies paid orders from the open API's first page that were never applied. */
export const reconcileAfdianOrders = async (event: H3Event) => {
  const env = getEnv(event)
  if (!isAfdianApiConfigured(env) || !readAfdianPlans(env).length) return null
  await ensureAfdianSchema(event)
  const { list } = await queryAfdianOrders(env, { page: 1, per_page: 50 })
  const report = { checked: list.length, matched: 0, unmatched: 0 }
  for (const order of list) {
    if (Number(order.status) !== 2 || !afdianPlanById(env, str(order.plan_id))) continue
    const seen = await findAfdianOrder(event, str(order.out_trade_no))
    if (seen && seen.status !== 'error' && seen.status !== 'processing') continue
    const outcome = await processAfdianOrder(event, order, { via: 'reconcile' })
    if (outcome.status === 'matched') report.matched += 1
    if (outcome.status === 'unmatched') report.unmatched += 1
  }
  return report
}

export type MembershipStatus = { status: 'member' | 'trial' | 'expired' | 'none'; valid_to: number | null }

/** What /membership shows for an account: active paid > active trial > lapsed > nothing. */
export const membershipStatus = async (event: H3Event, globalAccountId: string, plan: AfdianPlan): Promise<MembershipStatus> => {
  await ensureBillingSchema(event)
  const user = await findTenantUserByGlobalAccount(event, plan.tenant_id, globalAccountId)
  if (!user) return { status: 'none', valid_to: null }
  const now = nowInSeconds()
  const rows =
    (
      await getDb(event)
        .prepare(
          `SELECT valid_from, valid_to, source, meta_json FROM entitlements
           WHERE tenant_id = ? AND user_id = ? AND entitlement_key = ? AND status = 'granted'`,
        )
        .bind(plan.tenant_id, user.id, plan.entitlement_key)
        .all<{ valid_from: number; valid_to: number | null; source: string; meta_json: string | null }>()
    ).results || []
  const isTrial = (meta: string | null) => {
    try {
      return JSON.parse(meta || '{}')?.trial === true
    } catch {
      return false
    }
  }
  const active = rows.filter((row) => row.valid_from <= now && (row.valid_to === null || row.valid_to > now))
  if (active.length) {
    const forever = active.some((row) => row.valid_to === null)
    return {
      status: active.some((row) => !isTrial(row.meta_json)) ? 'member' : 'trial',
      valid_to: forever ? null : Math.max(...active.map((row) => Number(row.valid_to))),
    }
  }
  const lapsed = rows.filter((row) => row.valid_to !== null && row.valid_to <= now)
  if (lapsed.length) return { status: 'expired', valid_to: Math.max(...lapsed.map((row) => Number(row.valid_to))) }
  return { status: 'none', valid_to: null }
}
