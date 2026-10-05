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
import { syntheticWechatEmail } from './wechat'
import { writeAuditLog } from './audit'
import { issueTokens } from './auth'
import { ensureAccountEmailSchema } from './account-email'
import { randomId } from './crypto'
import { hashAccountPassword } from './password'
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

/**
 * Same-origin path only. Browsers read `/\host` as `//host`, so any backslash is refused,
 * as are control characters (a tab or newline inside `//` is stripped by URL parsers).
 */
export const safeContinue = (raw: unknown) => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return ''
  return value
}

/** JSON that is safe inside an inline <script>: `</script>`, `<!--` and line separators cannot break out. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

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

export const renderBridgeHtml = (input: { accessToken: string; email: string; redirectPath: string; nonce: string }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="cache-control" content="no-store" />
    <title>Signing in...</title>
  </head>
  <body>
    <script nonce="${input.nonce}">
      (function () {
        try {
          localStorage.setItem('sso_access_token', ${scriptJson(input.accessToken)});
          localStorage.setItem('sso_last_email', ${scriptJson(input.email)});
        } catch (_) {}
        window.location.replace(${scriptJson(safeContinue(input.redirectPath) || '/account')});
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
             refresh_token_client_id = CASE WHEN ? IS NULL THEN refresh_token_client_id ELSE ? END,
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
        profile.refreshTokenClientId || null,
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
         (id, global_account_id, provider, subject, email, profile_json, email_verified, is_private_email, refresh_token, refresh_token_client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      globalAccountId,
      profile.provider,
      profile.subject,
      profile.email || null,
      profileJson,
      emailVerified,
      isPrivate,
      profile.refreshToken || null,
      (profile.refreshToken && profile.refreshTokenClientId) || null,
    )
    .run()
  return id
}

/** True once the user clicked a verification link, or a linked provider vouched for the account's email. */
export const accountEmailVerified = async (event: H3Event, globalAccountId: string) => {
  await ensureAccountEmailSchema(event)
  const row = await getDb(event)
    .prepare(
      `SELECT 1 AS ok FROM global_accounts ga
       WHERE ga.id = ? AND (
         ga.email_verified_at IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM global_external_identities gei
           WHERE gei.global_account_id = ga.id AND gei.email_verified = 1 AND lower(gei.email) = lower(ga.email)
         )
       )`,
    )
    .bind(globalAccountId)
    .first<{ ok: number }>()
  return Boolean(row?.ok)
}

/**
 * Registration does not verify email, so anyone could have registered this address with a
 * password first. When a provider now proves who owns the address, that password (and every
 * session it opened) cannot be trusted: it is replaced and the sessions revoked, so a squatter
 * cannot keep a key to the real owner's account. The owner can set a new password afterwards.
 */
const revokeUnprovenPassword = async (event: H3Event, account: GlobalAccountRecord, profile: OAuthIdentityProfile) => {
  const db = getDb(event)
  const row = await db
    .prepare(`SELECT password_set FROM global_accounts WHERE id = ?`)
    .bind(account.id)
    .first<{ password_set?: number | null }>()
  if (Number(row?.password_set ?? 1) !== 1) return
  if (await accountEmailVerified(event, account.id)) return

  const env = getEnv(event)
  const placeholder = await hashAccountPassword(env, `oauth-claim-${randomId(32)}`)
  await db.batch([
    db
      .prepare(`UPDATE global_accounts SET password_hash = ?, password_set = 0, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(placeholder, account.id),
    db
      .prepare(
        `UPDATE sessions SET revoked_at = strftime('%s', 'now')
         WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE global_account_id = ?)`,
      )
      .bind(account.id),
  ])
  await writeAuditLog(event, {
    tenantId: null,
    userId: null,
    action: 'account.email_claimed_by_provider',
    payload: { global_account_id: account.id, provider: profile.provider, password_reset: true },
  })
}

export const resolveLoginAccount = async (event: H3Event, profile: OAuthIdentityProfile): Promise<GlobalAccountRecord> => {
  const linked = await findGlobalAccountByExternalIdentity(event, profile.provider, profile.subject)
  if (linked) return linked

  if (profile.email) {
    const byEmail = await findGlobalAccountByEmail(event, profile.email)
    if (byEmail) {
      if (mayAutoLinkByEmail(profile)) {
        await revokeUnprovenPassword(event, byEmail, profile)
        return byEmail
      }
      throw new AccountExistsError(profile.provider, profile.email)
    }
  }

  let email = profile.email || ''
  if (!email && profile.provider === 'apple') {
    email = await syntheticAppleEmail(profile.subject)
  }
  if (!email && profile.provider === 'wechat') {
    // WeChat never shares an email address; the account gets a non-deliverable placeholder.
    email = await syntheticWechatEmail(profile.subject)
  }
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Provider account email is required for first sign-in' })
  }
  const env = getEnv(event)
  const passwordHash = await hashAccountPassword(env, `oauth-${profile.provider}-${randomId(32)}`)
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

/**
 * Final step of every provider sign-in (browser OAuth and native exchanges): records the
 * identity on the account, provisions the client's tenant user and opens a session.
 */
export const signInAccount = async (
  event: H3Event,
  client: Awaited<ReturnType<typeof getClientByPublicId>>,
  account: GlobalAccountRecord,
  profile: OAuthIdentityProfile,
) => {
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
  const tokens = await issueTokens(event, provisioned.user, client, client.scope || 'openid profile email', { roles })
  return { provisioned, tokens }
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

    const { provisioned, tokens } = await signInAccount(event, client, account, profile)
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
    const nonce = randomId(16)
    return new Response(renderBridgeHtml({ accessToken: tokens.accessToken, email: provisioned.user.email, redirectPath, nonce }), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        'referrer-policy': 'no-referrer',
      },
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
