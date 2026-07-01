import { createError, H3Event } from 'h3'
import { requireAccessPrincipal } from './guard'
import { getDb } from './env'
import { ensureGlobalIdentitySchema } from './identity'

export type AccountUserContext = {
  principal: Awaited<ReturnType<typeof requireAccessPrincipal>>
  currentSessionId: string
  user: {
    id: string
    tenant_id: string
    email: string
    locale?: string | null
    created_at: number
    global_account_id?: string | null
  }
  globalAccount: {
    id: string
    email: string
    locale?: string | null
    status: string
    display_name?: string | null
    avatar_url?: string | null
    created_at: number
    updated_at: number
  } | null
}

export const requireAccountUserContext = async (event: H3Event): Promise<AccountUserContext> => {
  const principal = await requireAccessPrincipal(event)
  await ensureGlobalIdentitySchema(event)

  const db = getDb(event)
  const row = await db
    .prepare(
      `SELECT
         u.id,
         u.tenant_id,
         u.email,
         u.locale,
         u.created_at,
         u.global_account_id,
         ga.id AS ga_id,
         ga.email AS ga_email,
         ga.locale AS ga_locale,
         ga.status AS ga_status,
         ga.display_name AS ga_display_name,
         ga.avatar_url AS ga_avatar_url,
         ga.created_at AS ga_created_at,
         ga.updated_at AS ga_updated_at
       FROM users u
       LEFT JOIN global_accounts ga ON ga.id = u.global_account_id
       WHERE u.id = ?`,
    )
    .bind(principal.sub)
    .first<{
      id: string
      tenant_id: string
      email: string
      locale?: string | null
      created_at: number
      global_account_id?: string | null
      ga_id?: string | null
      ga_email?: string | null
      ga_locale?: string | null
      ga_status?: string | null
      ga_display_name?: string | null
      ga_avatar_url?: string | null
      ga_created_at?: number | null
      ga_updated_at?: number | null
    }>()

  if (!row?.id) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  if (row.tenant_id !== principal.tid) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }

  const payloadSid = principal.payload?.sid
  const currentSessionId = typeof payloadSid === 'string' ? payloadSid : ''

  return {
    principal,
    currentSessionId,
    user: {
      id: row.id,
      tenant_id: row.tenant_id,
      email: row.email,
      locale: row.locale || null,
      created_at: Number(row.created_at || 0),
      global_account_id: row.global_account_id || null,
    },
    globalAccount: row.ga_id
      ? {
          id: row.ga_id,
          email: row.ga_email || row.email,
          locale: row.ga_locale || null,
          status: row.ga_status || 'active',
          display_name: row.ga_display_name || null,
          avatar_url: row.ga_avatar_url || null,
          created_at: Number(row.ga_created_at || 0),
          updated_at: Number(row.ga_updated_at || 0),
        }
      : null,
  }
}
