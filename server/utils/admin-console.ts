import { createError, H3Event } from 'h3'
import { getDb } from './env'
import { oncePerDb } from './schema-once'
import { platformTenantId, requireAccessPrincipal, requireTenantAdmin, type AccessPrincipal } from './guard'

const adminConsoleSchema = oncePerDb(async (db) => {
  // The account detail view reads one account's audit trail; without this it scans the table.
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id, created_at DESC)`).run()
  // Admin actions on an account are logged under the admin; partial, so only those rows pay for it.
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs (json_extract(payload_json, '$.target_global_account_id'))
       WHERE json_extract(payload_json, '$.target_global_account_id') IS NOT NULL`,
    )
    .run()
})

export const ensureAdminConsoleSchema = (event: H3Event) => adminConsoleSchema(getDb(event))

export type AdminScope = {
  principal: AccessPrincipal
  /** Admin of the platform tenant: may see every tenant and every global account. */
  platform: boolean
}

/**
 * Any tenant admin signed in through the account center. Platform admins get the cross-tenant
 * view; everyone else is pinned to the tenant in their token.
 */
export const requireAdminScope = async (event: H3Event): Promise<AdminScope> => {
  const { tid } = await requireAccessPrincipal(event)
  const principal = await requireTenantAdmin(event, tid)
  return { principal, platform: principal.tid === (await platformTenantId(event)) }
}

/** Tenant to read, given an optional requested one: platform admins pick any, others get their own. */
export const scopedTenantId = (scope: AdminScope, requested: string) => {
  if (!requested) return scope.platform ? '' : scope.principal.tid
  if (!scope.platform && requested !== scope.principal.tid) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }
  return requested
}

export const clampLimit = (raw: unknown, fallback: number, max: number) => {
  const value = Number(raw ?? fallback)
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), max) : fallback
}

export const parseJsonObject = (raw: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
