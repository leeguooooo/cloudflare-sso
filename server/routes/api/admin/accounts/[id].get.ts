import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../../utils/env'
import { requirePlatformAdmin } from '../../../../utils/guard'
import { ensureAdminConsoleSchema, parseJsonObject } from '../../../../utils/admin-console'

type Row = Record<string, unknown>

const nowInSeconds = () => Math.floor(Date.now() / 1000)

/**
 * GET /api/admin/accounts/:id — everything about one global account: profile, the app (tenant)
 * users it maps to with roles, sign-in methods, sessions, entitlements, subscriptions and the
 * latest audit entries. Secrets (password hash, provider refresh tokens) are never returned.
 */
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  await ensureAdminConsoleSchema(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const id = String(getRouterParam(event, 'id') || '').trim()
  const db = getDb(event)

  const account = await db
    .prepare(
      `SELECT id, email, display_name, avatar_url, locale, status, password_set, created_at, updated_at
       FROM global_accounts WHERE id = ?`,
    )
    .bind(id)
    .first<{ id: string; email: string; display_name: string | null; avatar_url: string | null; locale: string | null; status: string; password_set: number | null; created_at: number; updated_at: number }>()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })

  const now = nowInSeconds()
  const [users, identities, sessions, entitlements, subscriptions, audit] = await Promise.all([
    db
      .prepare(
        `SELECT u.id, u.tenant_id, t.name AS tenant_name, u.email, u.status, u.created_at,
           (SELECT group_concat(r.name, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.global_account_id = ?
         ORDER BY u.created_at ASC`,
      )
      .bind(id)
      .all<Row>(),
    db
      .prepare(
        `SELECT provider, email, email_verified, is_private_email, consent_revoked_at, created_at
         FROM global_external_identities WHERE global_account_id = ? ORDER BY created_at ASC`,
      )
      .bind(id)
      .all<Row>(),
    db
      .prepare(
        `SELECT s.id, s.tenant_id, c.client_id, c.name AS client_name, s.ip, s.user_agent, s.created_at, s.rotated_at, s.expires_at, s.revoked_at
         FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN clients c ON c.id = s.client_id
         WHERE u.global_account_id = ?
         ORDER BY s.created_at DESC LIMIT 50`,
      )
      .bind(id)
      .all<Row>(),
    db
      .prepare(
        `SELECT e.id, e.tenant_id, e.entitlement_key, e.source, e.status, e.valid_from, e.valid_to, e.revoked_at, e.meta_json
         FROM entitlements e JOIN users u ON u.id = e.user_id
         WHERE u.global_account_id = ?
         ORDER BY e.valid_from DESC LIMIT 100`,
      )
      .bind(id)
      .all<Row>(),
    db
      .prepare(
        `SELECT s.id, s.tenant_id, p.plan_key, s.provider, s.status, s.current_period_end, s.cancel_at_period_end, s.created_at
         FROM subscriptions s JOIN users u ON u.id = s.user_id LEFT JOIN plans p ON p.id = s.plan_id
         WHERE u.global_account_id = ?
         ORDER BY s.created_at DESC LIMIT 50`,
      )
      .bind(id)
      .all<Row>(),
    db
      .prepare(
        `SELECT a.id, a.tenant_id, a.action, a.ip, a.payload_json, a.created_at
         FROM audit_logs a
         WHERE a.user_id IN (SELECT u.id FROM users u WHERE u.global_account_id = ?)
            OR json_extract(a.payload_json, '$.target_global_account_id') = ?
         ORDER BY a.created_at DESC LIMIT 50`,
      )
      .bind(id, id)
      .all<Row>(),
  ])

  const results = (r: { results?: Row[] }) => r.results || []

  return {
    account: { ...account, password_set: account.password_set !== 0 },
    users: results(users).map((row) => ({ ...row, roles: row.roles ? [...new Set(String(row.roles).split(','))] : [] })),
    identities: results(identities).map((row) => ({
      ...row,
      email_verified: row.email_verified === 1,
      is_private_email: row.is_private_email === 1,
    })),
    sessions: results(sessions).map((row) => ({
      ...row,
      active: !row.revoked_at && Number(row.expires_at) > now,
    })),
    entitlements: results(entitlements).map(({ meta_json, ...row }) => {
      const meta = parseJsonObject(meta_json as string)
      const active = row.status === 'granted' && Number(row.valid_from) <= now && (row.valid_to == null || Number(row.valid_to) > now)
      return { ...row, trial: meta.trial === true, provider: typeof meta.provider === 'string' ? meta.provider : null, active }
    }),
    subscriptions: results(subscriptions).map((row) => ({ ...row, cancel_at_period_end: row.cancel_at_period_end === 1 })),
    audit: results(audit).map(({ payload_json, ...row }) => ({ ...row, payload: parseJsonObject(payload_json as string) })),
  }
})
