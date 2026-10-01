import { createError, H3Event } from 'h3'
import type { AccountUserContext } from './account'
import { getDb } from './env'

/** Linking, unlinking, setting a password and merging require a sign-in this recent. */
export const RECENT_AUTH_SECONDS = 15 * 60

export const REAUTH_REQUIRED = 'reauth_required'

export const isRecentAuth = (sessionCreatedAt: number | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)) =>
  typeof sessionCreatedAt === 'number' && sessionCreatedAt > 0 && nowSeconds - sessionCreatedAt <= RECENT_AUTH_SECONDS

/** created_at of the session = when the user last actually signed in (refresh keeps it). */
export const sessionSignedInAt = async (event: H3Event, sessionId: string) => {
  if (!sessionId) return null
  const row = await getDb(event)
    .prepare(`SELECT created_at, revoked_at FROM sessions WHERE id = ?`)
    .bind(sessionId)
    .first<{ created_at: number; revoked_at?: number | null }>()
  if (!row || row.revoked_at) return null
  return Number(row.created_at || 0)
}

export const requireRecentAuth = async (event: H3Event, ctx: AccountUserContext) => {
  const signedInAt = await sessionSignedInAt(event, ctx.currentSessionId)
  if (!isRecentAuth(signedInAt)) {
    throw createError({ statusCode: 403, statusMessage: REAUTH_REQUIRED, data: { code: REAUTH_REQUIRED } })
  }
}

export type SignInMethod =
  | { kind: 'password'; email: string }
  | {
      kind: 'provider'
      id: string
      provider: string
      email: string | null
      is_private_email: boolean
      email_disabled: boolean
      consent_revoked: boolean
      name: string | null
      created_at: number
    }

export const listSignInMethods = async (event: H3Event, gaid: string): Promise<SignInMethod[]> => {
  const db = getDb(event)
  const account = await db
    .prepare(`SELECT email, password_set FROM global_accounts WHERE id = ?`)
    .bind(gaid)
    .first<{ email: string; password_set?: number | null }>()
  const rows =
    (
      await db
        .prepare(
          `SELECT id, provider, email, profile_json, is_private_email, email_disabled, consent_revoked_at, created_at
           FROM global_external_identities WHERE global_account_id = ? ORDER BY created_at`,
        )
        .bind(gaid)
        .all<{
          id: string
          provider: string
          email?: string | null
          profile_json?: string | null
          is_private_email?: number | null
          email_disabled?: number | null
          consent_revoked_at?: number | null
          created_at: number
        }>()
    ).results || []
  const methods: SignInMethod[] = []
  if (account?.password_set === 1) methods.push({ kind: 'password', email: account.email })
  for (const row of rows) {
    let name: string | null = null
    try {
      const profile = JSON.parse(row.profile_json || '{}')
      name = typeof profile?.name === 'string' && profile.name ? profile.name : null
    } catch {
      name = null
    }
    methods.push({
      kind: 'provider',
      id: row.id,
      provider: row.provider,
      email: row.email || null,
      is_private_email: row.is_private_email === 1,
      email_disabled: row.email_disabled === 1,
      consent_revoked: Boolean(row.consent_revoked_at),
      name,
      created_at: Number(row.created_at || 0),
    })
  }
  return methods
}

/** Removing `identityId` must leave at least one way to sign in. */
export const canRemoveIdentity = (methods: SignInMethod[], identityId: string) =>
  methods.some((method) => method.kind === 'password' || (method.kind === 'provider' && method.id !== identityId))
