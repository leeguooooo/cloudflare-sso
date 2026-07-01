import { defineEventHandler } from 'h3'
import { getDb } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'

type LinkedIdentityRow = {
  provider: string
  subject: string
  email?: string | null
  profile_json?: string | null
  created_at: number
  updated_at: number
}

const parseJsonRecord = (raw: string | null | undefined) => {
  if (!raw) return {} as Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const summarizeUserAgent = (ua: string | null | undefined) => {
  const value = (ua || '').trim()
  if (!value) return 'Unknown device'
  if (/iphone|ipad|ios/i.test(value)) return 'iOS device'
  if (/android/i.test(value)) return 'Android device'
  if (/macintosh|mac os/i.test(value)) return 'macOS browser'
  if (/windows/i.test(value)) return 'Windows browser'
  if (/linux/i.test(value)) return 'Linux browser'
  return 'Browser session'
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const db = getDb(event)
  const now = Math.floor(Date.now() / 1000)

  const linkedRows = ctx.globalAccount?.id
    ? await db
        .prepare(
          `SELECT provider, subject, email, profile_json, created_at, updated_at
           FROM global_external_identities
           WHERE global_account_id = ?
           ORDER BY updated_at DESC`,
        )
        .bind(ctx.globalAccount.id)
        .all<LinkedIdentityRow>()
    : { results: [] as LinkedIdentityRow[] }

  const sessions = await db
    .prepare(
      `SELECT
         s.id,
         s.client_id,
         s.user_agent,
         s.ip,
         s.expires_at,
         s.revoked_at,
         s.created_at,
         c.client_id AS client_public_id,
         c.name AS client_name
       FROM sessions s
       LEFT JOIN clients c ON c.id = s.client_id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 30`,
    )
    .bind(ctx.user.id)
    .all<{
      id: string
      client_id?: string | null
      user_agent?: string | null
      ip?: string | null
      expires_at: number
      revoked_at?: number | null
      created_at: number
      client_public_id?: string | null
      client_name?: string | null
    }>()

  const activity = await db
    .prepare(
      `SELECT action, ip, user_agent, payload_json, created_at
       FROM audit_logs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 40`,
    )
    .bind(ctx.user.id)
    .all<{ action: string; ip?: string | null; user_agent?: string | null; payload_json?: string | null; created_at: number }>()

  const sharingClients = await db
    .prepare(
      `SELECT
         COALESCE(c.client_id, '(unknown)') AS client_id,
         COALESCE(c.name, 'Unknown app') AS client_name,
         MAX(s.created_at) AS last_seen_at,
         SUM(CASE WHEN s.revoked_at IS NULL THEN 1 ELSE 0 END) AS active_sessions,
         COUNT(*) AS session_count
       FROM sessions s
       LEFT JOIN clients c ON c.id = s.client_id
       WHERE s.user_id = ?
       GROUP BY c.id, c.client_id, c.name
       ORDER BY last_seen_at DESC
       LIMIT 20`,
    )
    .bind(ctx.user.id)
    .all<{
      client_id: string
      client_name: string
      last_seen_at: number
      active_sessions: number
      session_count: number
    }>()

  const subscriptions = await db
    .prepare(
      `SELECT
         s.id,
         s.status,
         s.provider,
         s.provider_ref,
         s.started_at,
         s.current_period_start,
         s.current_period_end,
         s.cancel_at_period_end,
         s.canceled_at,
         s.updated_at,
         p.plan_key,
         p.name AS plan_name,
         p.currency,
         p.amount_minor,
         p.billing_cycle,
         pr.product_key,
         pr.name AS product_name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN products pr ON pr.id = p.product_id
       WHERE s.tenant_id = ? AND s.user_id = ?
       ORDER BY s.updated_at DESC
       LIMIT 30`,
    )
    .bind(ctx.user.tenant_id, ctx.user.id)
    .all<{
      id: string
      status: string
      provider: string
      provider_ref?: string | null
      started_at: number
      current_period_start?: number | null
      current_period_end?: number | null
      cancel_at_period_end: number
      canceled_at?: number | null
      updated_at: number
      plan_key: string
      plan_name: string
      currency: string
      amount_minor: number
      billing_cycle: string
      product_key?: string | null
      product_name?: string | null
    }>()

  const entitlementRows = await db
    .prepare(
      `SELECT entitlement_key, source, status, valid_from, valid_to, revoked_at, subscription_id, updated_at
       FROM entitlements
       WHERE tenant_id = ? AND user_id = ?
       ORDER BY updated_at DESC
       LIMIT 120`,
    )
    .bind(ctx.user.tenant_id, ctx.user.id)
    .all<{
      entitlement_key: string
      source: string
      status: string
      valid_from: number
      valid_to?: number | null
      revoked_at?: number | null
      subscription_id?: string | null
      updated_at: number
    }>()

  const linkedIdentities = (linkedRows.results || []).map((row) => {
    const profile = parseJsonRecord(row.profile_json)
    const avatarFromProfile =
      typeof profile.avatar_url === 'string' && profile.avatar_url.trim()
        ? profile.avatar_url.trim()
        : typeof profile.picture === 'string' && profile.picture.trim()
          ? profile.picture.trim()
          : null

    return {
      provider: row.provider,
      subject: row.subject,
      email: row.email || null,
      name: typeof profile.name === 'string' ? profile.name : null,
      avatar_url: avatarFromProfile,
      created_at: Number(row.created_at || 0),
      updated_at: Number(row.updated_at || 0),
    }
  })

  const activeEntitlementKeys = [
    ...new Set(
      (entitlementRows.results || [])
        .filter((item) => item.status === 'granted')
        .filter((item) => !item.valid_to || item.valid_to >= now)
        .map((item) => item.entitlement_key),
    ),
  ]

  return {
    profile: {
      sub: ctx.user.id,
      tid: ctx.user.tenant_id,
      gaid: ctx.globalAccount?.id || null,
      client_id: ctx.principal.aud || null,
      email: ctx.user.email,
      locale: ctx.user.locale || ctx.globalAccount?.locale || 'en',
      name: ctx.globalAccount?.display_name || null,
      avatar_url: ctx.globalAccount?.avatar_url || null,
      roles: ctx.principal.roles,
      perms: ctx.principal.perms,
      created_at: ctx.user.created_at,
      global_account_created_at: ctx.globalAccount?.created_at || null,
    },
    linked_identities: linkedIdentities,
    sessions: (sessions.results || []).map((row) => ({
      id: row.id,
      client_id: row.client_public_id || null,
      client_name: row.client_name || null,
      user_agent: row.user_agent || '',
      device_label: summarizeUserAgent(row.user_agent),
      ip: row.ip || '',
      created_at: Number(row.created_at || 0),
      expires_at: Number(row.expires_at || 0),
      revoked_at: row.revoked_at ? Number(row.revoked_at) : null,
      is_current: ctx.currentSessionId ? row.id === ctx.currentSessionId : false,
    })),
    recent_activity: (activity.results || []).map((row) => ({
      action: row.action,
      ip: row.ip || '',
      user_agent: row.user_agent || '',
      payload: parseJsonRecord(row.payload_json),
      created_at: Number(row.created_at || 0),
    })),
    sharing: {
      roles: ctx.principal.roles,
      clients: (sharingClients.results || []).map((row) => ({
        client_id: row.client_id,
        client_name: row.client_name,
        last_seen_at: Number(row.last_seen_at || 0),
        active_sessions: Number(row.active_sessions || 0),
        session_count: Number(row.session_count || 0),
      })),
    },
    billing: {
      subscriptions: (subscriptions.results || []).map((row) => ({
        id: row.id,
        status: row.status,
        provider: row.provider,
        provider_ref: row.provider_ref || null,
        started_at: Number(row.started_at || 0),
        current_period_start: row.current_period_start ? Number(row.current_period_start) : null,
        current_period_end: row.current_period_end ? Number(row.current_period_end) : null,
        cancel_at_period_end: row.cancel_at_period_end === 1,
        canceled_at: row.canceled_at ? Number(row.canceled_at) : null,
        updated_at: Number(row.updated_at || 0),
        plan_key: row.plan_key,
        plan_name: row.plan_name,
        currency: row.currency,
        amount_minor: Number(row.amount_minor || 0),
        billing_cycle: row.billing_cycle,
        product_key: row.product_key || null,
        product_name: row.product_name || null,
      })),
      active_entitlement_keys: activeEntitlementKeys,
      entitlements: (entitlementRows.results || []).map((row) => ({
        entitlement_key: row.entitlement_key,
        source: row.source,
        status: row.status,
        valid_from: Number(row.valid_from || 0),
        valid_to: row.valid_to ? Number(row.valid_to) : null,
        revoked_at: row.revoked_at ? Number(row.revoked_at) : null,
        subscription_id: row.subscription_id || null,
        updated_at: Number(row.updated_at || 0),
      })),
    },
  }
})
