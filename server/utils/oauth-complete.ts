/**
 * Finishing a provider round trip (Google, GitHub, Apple), for both intents:
 *
 * login — the identity (provider, subject) is looked up first. If it is not linked
 *   anywhere and its email belongs to an existing account:
 *     - Google / GitHub with a provider-VERIFIED email: linked automatically. This is
 *       the behaviour the issuer always had for Google / GitHub, kept (now limited to
 *       verified addresses — GitHub used to fall back to unverified ones).
 *     - everything else (Apple, unverified emails): never linked silently. The user is
 *       sent back to the login page with `oauth_error_code=account_exists` and told to
 *       sign in with the existing method and link the provider from the account page.
 *   Otherwise a new account is created (password_set = 0).
 *
 * link — the identity is attached to the account recorded in the server-side state.
 *   If it already belongs to ANOTHER account, a merge proposal is created and the
 *   user is sent to /account?section=linked&merge=<id> to review and confirm.
 */
import { createError, deleteCookie, getRequestHeader, getRequestURL, H3Event, sendRedirect, setCookie } from 'h3'
import { getUserRolesForClient } from './access'
import { syntheticAppleEmail } from './apple'
import { writeAuditLog } from './audit'
import { issueTokens } from './auth'
import { hashPassword, randomId } from './crypto'
import { getDb, getEnv } from './env'
import {
  createGlobalAccount,
  ensureGlobalIdentitySchema,
  findGlobalAccountByEmail,
  findGlobalAccountByExternalIdentity,
  findGlobalAccountById,
  getClientByPublicId,
  provisionTenantUserForGlobalAccount,
  type GlobalAccountRecord,
} from './identity'
import { createMergeProposal } from './account-merge'
import { OAUTH_STATE_COOKIE, type OAuthStatePayload } from './oauth-state'
import type { OAuthIdentityProfile } from './oauth'

export const PROVIDER_LABELS: Record<string, string> = { apple: 'Apple', google: 'Google', github: 'GitHub' }

/** Whether an unlinked provider identity may be attached to the account owning the same email. */
export const mayAutoLinkByEmail = (profile: Pick<OAuthIdentityProfile, 'provider' | 'email' | 'emailVerified'>) =>
  Boolean(profile.email) && profile.emailVerified === true && (profile.provider === 'google' || profile.provider === 'github')

export class AccountExistsError extends Error {
  constructor(readonly provider: string, readonly email: string) {
    super('An account with this email already exists')
  }
}

export const safeContinue = (raw: unknown) => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  return value
}

export const isSecureRequest = (event: H3Event) => {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  if (forwardedProto) return forwardedProto === 'https'
  return getRequestURL(event).protocol === 'https:'
}

export const errorMessageOf = (error: unknown) => {
  if (error && typeof error === 'object' && 'statusMessage' in error && typeof error.statusMessage === 'string') {
    return error.statusMessage
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'OAuth sign-in failed'
}

export const buildLoginPath = (input: {
  message?: string
  code?: string
  provider?: string
  email?: string
  continuePath?: string
  clientId?: string
}) => {
  const params = new URLSearchParams()
  if (input.message) params.set('oauth_error', input.message)
  if (input.code) params.set('oauth_error_code', input.code)
  if (input.provider) params.set('provider', input.provider)
  if (input.email) params.set('email', input.email)
  if (input.clientId) params.set('client_id', input.clientId)
  const continuePath = safeContinue(input.continuePath || '')
  if (continuePath) params.set('continue', continuePath)
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

export const withQuery = (path: string, values: Record<string, string>) => {
  const url = new URL(safeContinue(path) || '/account?section=linked', 'https://account.local')
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

const renderBridgeHtml = (input: { accessToken: string; email: string; redirectPath: string }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="cache-control" content="no-store" />
    <title>Signing in...</title>
  </head>
  <body>
    <script>
      (function () {
        try {
          localStorage.setItem('sso_access_token', ${JSON.stringify(input.accessToken)});
          localStorage.setItem('sso_last_email', ${JSON.stringify(input.email)});
        } catch (_) {}
        window.location.replace(${JSON.stringify(input.redirectPath)});
      })();
    </script>
  </body>
</html>`

/** Inserts or refreshes the identity row (Apple flags, refresh token). Throws 409 if owned by another account. */
export const upsertIdentity = async (event: H3Event, globalAccountId: string, profile: OAuthIdentityProfile) => {
  const db = getDb(event)
  const existing = await db
    .prepare(`SELECT id, global_account_id FROM global_external_identities WHERE provider = ? AND subject = ?`)
    .bind(profile.provider, profile.subject)
    .first<{ id: string; global_account_id: string }>()
  const profileJson = JSON.stringify({
    name: profile.name || '',
    avatar_url: profile.avatarUrl || '',
    raw: profile.provider === 'apple' ? {} : profile.profile,
  })
  const emailVerified = profile.emailVerified === undefined ? null : profile.emailVerified ? 1 : 0
  const isPrivate = profile.isPrivateEmail === undefined ? null : profile.isPrivateEmail ? 1 : 0

  if (existing?.id) {
    if (existing.global_account_id !== globalAccountId) {
      throw createError({ statusCode: 409, statusMessage: 'External identity already linked to another account' })
    }
    // Apple omits the email on some later sign-ins: keep what we have then.
    await db
      .prepare(
        `UPDATE global_external_identities
         SET email = COALESCE(?, email),
             profile_json = CASE WHEN ? = 1 THEN profile_json ELSE ? END,
             email_verified = COALESCE(?, email_verified),
             is_private_email = COALESCE(?, is_private_email),
             refresh_token = COALESCE(?, refresh_token),
             consent_revoked_at = NULL,
             updated_at = strftime('%s', 'now')
         WHERE id = ?`,
      )
      .bind(
        profile.email || null,
        profile.provider === 'apple' && !profile.name ? 1 : 0,
        profileJson,
        emailVerified,
        isPrivate,
        profile.refreshToken || null,
        existing.id,
      )
      .run()
    return existing.id
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO global_external_identities
         (id, global_account_id, provider, subject, email, profile_json, email_verified, is_private_email, refresh_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, globalAccountId, profile.provider, profile.subject, profile.email || null, profileJson, emailVerified, isPrivate, profile.refreshToken || null)
    .run()
  return id
}

const resolveLoginAccount = async (event: H3Event, profile: OAuthIdentityProfile): Promise<GlobalAccountRecord> => {
  const linked = await findGlobalAccountByExternalIdentity(event, profile.provider, profile.subject)
  if (linked) return linked

  if (profile.email) {
    const byEmail = await findGlobalAccountByEmail(event, profile.email)
    if (byEmail) {
      if (mayAutoLinkByEmail(profile)) return byEmail
      throw new AccountExistsError(profile.provider, profile.email)
    }
  }

  let email = profile.email || ''
  if (!email && profile.provider === 'apple') {
    email = await syntheticAppleEmail(profile.subject)
  }
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Provider account email is required for first sign-in' })
  }
  const env = getEnv(event)
  const passwordHash = await hashPassword(`oauth-${profile.provider}-${randomId(32)}`, env.PASSWORD_PEPPER || '')
  const id = await createGlobalAccount(event, {
    email,
    passwordHash,
    locale: 'en',
    passwordSet: false,
    displayName: profile.name || null,
  })
  const created = await findGlobalAccountById(event, id)
  if (!created) throw createError({ statusCode: 500, statusMessage: 'Failed to resolve global account' })
  return created
}

/** Runs after the provider proved the identity. Always answers with a redirect / bridge page. */
export const completeOAuthSignIn = async (event: H3Event, state: OAuthStatePayload, profile: OAuthIdentityProfile) => {
  const continuePath = safeContinue(state.continue)
  const isLink = state.intent === 'link' && Boolean(state.link_global_account_id)
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })

  try {
    await ensureGlobalIdentitySchema(event)
    const client = await getClientByPublicId(event, state.client_id)

    let account: GlobalAccountRecord | null
    if (isLink) {
      account = await findGlobalAccountById(event, String(state.link_global_account_id))
      if (!account) throw createError({ statusCode: 404, statusMessage: 'Current account no longer exists' })
      const owner = await findGlobalAccountByExternalIdentity(event, profile.provider, profile.subject)
      if (owner && owner.id !== account.id) {
        // Refresh the identity details on its current owner, then ask the user about merging.
        await upsertIdentity(event, owner.id, profile)
        const mergeId = await createMergeProposal(event, {
          fromGlobalAccountId: owner.id,
          toGlobalAccountId: account.id,
          provider: profile.provider,
          subject: profile.subject,
        })
        return sendRedirect(event, withQuery(continuePath || '/account?section=linked', { section: 'linked', merge: mergeId }), 302)
      }
    } else {
      account = await resolveLoginAccount(event, profile)
    }

    if (account.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
    }

    await upsertIdentity(event, account.id, profile)
    if (profile.name && !account.display_name) {
      await getDb(event)
        .prepare(`UPDATE global_accounts SET display_name = ?, updated_at = strftime('%s', 'now') WHERE id = ? AND (display_name IS NULL OR display_name = '')`)
        .bind(profile.name, account.id)
        .run()
    }

    const provisioned = await provisionTenantUserForGlobalAccount(event, {
      tenantId: client.tenant_id,
      globalAccountId: account.id,
      email: account.email,
      locale: account.locale || 'en',
    })
    if (provisioned.user.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })
    }

    const roles = await getUserRolesForClient(event, provisioned.user.id, provisioned.user.tenant_id, client.id)
    const tokens = await issueTokens(event, provisioned.user, client, client.scope || 'openid profile email', undefined, roles)
    setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isSecureRequest(event),
      sameSite: 'lax',
      path: '/',
      expires: new Date(tokens.refreshTokenExpiresAt * 1000),
    })

    await writeAuditLog(event, {
      tenantId: provisioned.user.tenant_id,
      userId: provisioned.user.id,
      action: isLink ? 'account.linked.oauth_link' : 'auth.oauth_login',
      payload: {
        intent: isLink ? 'link' : 'login',
        provider: profile.provider,
        global_account_id: provisioned.user.global_account_id || null,
        provisioned_created: provisioned.created,
        client_id: client.client_id,
      },
    })

    const redirectPath = isLink
      ? withQuery(continuePath || '/account?section=linked', { linked: profile.provider })
      : continuePath || '/account'
    return new Response(renderBridgeHtml({ accessToken: tokens.accessToken, email: provisioned.user.email, redirectPath }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    if (isLink) {
      return sendRedirect(event, withQuery(continuePath || '/account?section=linked', { link_error: errorMessageOf(error) }), 302)
    }
    if (error instanceof AccountExistsError) {
      return sendRedirect(
        event,
        buildLoginPath({
          code: 'account_exists',
          provider: error.provider,
          email: error.email,
          continuePath,
          clientId: state.client_id,
        }),
        302,
      )
    }
    return sendRedirect(
      event,
      buildLoginPath({ message: errorMessageOf(error), continuePath, clientId: state.client_id }),
      302,
    )
  }
}
