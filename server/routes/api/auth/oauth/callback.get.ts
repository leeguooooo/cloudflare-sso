import {
  createError,
  defineEventHandler,
  deleteCookie,
  getCookie,
  getRequestHeader,
  getQuery,
  getRequestURL,
  H3Event,
  sendRedirect,
  setCookie,
} from 'h3'
import { issueTokens } from '../../../../utils/auth'
import { writeAuditLog } from '../../../../utils/audit'
import { hashPassword, randomId } from '../../../../utils/crypto'
import { getEnv } from '../../../../utils/env'
import { getUserRolesForClient } from '../../../../utils/access'
import {
  createGlobalAccount,
  ensureGlobalIdentitySchema,
  findGlobalAccountByEmail,
  findGlobalAccountByExternalIdentity,
  findGlobalAccountById,
  getClientByPublicId,
  linkExternalIdentityToGlobalAccount,
  provisionTenantUserForGlobalAccount,
} from '../../../../utils/identity'
import { getOAuthIdentityProfile, parseOAuthProvider } from '../../../../utils/oauth'

type OAuthStatePayload = {
  state: string
  provider: string
  client_id: string
  continue: string
  created_at: number
}

const resolveContinuePath = (raw: unknown) => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/')) return ''
  if (value.startsWith('//')) return ''
  return value
}

const isSecureCookie = (event: H3Event) => {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  if (forwardedProto) {
    return forwardedProto === 'https'
  }
  return getRequestURL(event).protocol === 'https:'
}

const buildLoginPath = (input: { message: string; continuePath?: string; clientId?: string }) => {
  const params = new URLSearchParams()
  params.set('oauth_error', input.message)
  if (input.clientId) {
    params.set('client_id', input.clientId)
  }
  const continuePath = resolveContinuePath(input.continuePath || '')
  if (continuePath) {
    params.set('continue', continuePath)
  }
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

const renderOAuthBridgeHtml = (input: { accessToken: string; email: string; redirectPath: string }) => {
  const accessToken = JSON.stringify(input.accessToken)
  const email = JSON.stringify(input.email)
  const redirectPath = JSON.stringify(input.redirectPath)

  return `<!doctype html>
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
          localStorage.setItem('sso_access_token', ${accessToken});
          localStorage.setItem('sso_last_email', ${email});
        } catch (_) {}
        window.location.replace(${redirectPath});
      })();
    </script>
  </body>
</html>`
}

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'statusMessage' in error && typeof error.statusMessage === 'string') {
    return error.statusMessage
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'OAuth sign-in failed'
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const provider = parseOAuthProvider(query.provider)
  const code = String(query.code || '').trim()
  const state = String(query.state || '').trim()

  const providerError = String(query.error || '').trim()
  if (providerError) {
    deleteCookie(event, 'sso_oauth_state', { path: '/' })
    const errorDescription = String(query.error_description || providerError).trim()
    return sendRedirect(event, buildLoginPath({ message: errorDescription }), 302)
  }

  if (!code || !state) {
    throw createError({ statusCode: 400, statusMessage: 'code and state required' })
  }

  const stateCookie = getCookie(event, 'sso_oauth_state')
  if (!stateCookie) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state expired, please try again' })
  }

  let parsedState: OAuthStatePayload | null = null
  try {
    parsedState = JSON.parse(stateCookie) as OAuthStatePayload
  } catch {
    parsedState = null
  }
  if (!parsedState?.state || !parsedState.client_id || !parsedState.provider) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state invalid, please try again' })
  }
  if (parsedState.state !== state || parsedState.provider !== provider) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state mismatch, please try again' })
  }

  const continuePath = resolveContinuePath(parsedState.continue)

  try {
    await ensureGlobalIdentitySchema(event)
    const client = await getClientByPublicId(event, parsedState.client_id)
    const profile = await getOAuthIdentityProfile(event, { provider, code })

    let globalAccount = await findGlobalAccountByExternalIdentity(event, provider, profile.subject)

    if (!globalAccount && profile.email) {
      globalAccount = await findGlobalAccountByEmail(event, profile.email)
    }

    if (!globalAccount) {
      if (!profile.email) {
        throw createError({ statusCode: 400, statusMessage: 'Provider account email is required for first sign-in' })
      }
      const env = getEnv(event)
      const passwordHash = await hashPassword(`oauth-${provider}-${randomId(32)}`, env.PASSWORD_PEPPER || '')
      const globalAccountId = await createGlobalAccount(event, {
        email: profile.email,
        passwordHash,
        locale: 'en',
      })
      globalAccount = await findGlobalAccountById(event, globalAccountId)
    }

    if (!globalAccount) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to resolve global account' })
    }
    if (globalAccount.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
    }

    await linkExternalIdentityToGlobalAccount(event, {
      globalAccountId: globalAccount.id,
      provider,
      subject: profile.subject,
      email: profile.email || null,
      profile: {
        name: profile.name || '',
        avatar_url: profile.avatarUrl || '',
        raw: profile.profile,
      },
    })

    const provisioned = await provisionTenantUserForGlobalAccount(event, {
      tenantId: client.tenant_id,
      globalAccountId: globalAccount.id,
      email: globalAccount.email,
      locale: globalAccount.locale || 'en',
    })

    if (provisioned.user.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })
    }

    const roles = await getUserRolesForClient(event, provisioned.user.id, provisioned.user.tenant_id, client.id)
    const tokens = await issueTokens(event, provisioned.user, client, client.scope || 'openid profile email', undefined, roles)

    setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isSecureCookie(event),
      sameSite: 'lax',
      path: '/',
      expires: new Date(tokens.refreshTokenExpiresAt * 1000),
    })
    deleteCookie(event, 'sso_oauth_state', { path: '/' })

    await writeAuditLog(event, {
      tenantId: provisioned.user.tenant_id,
      userId: provisioned.user.id,
      action: 'auth.oauth_login',
      payload: {
        provider,
        provider_subject: profile.subject,
        global_account_id: provisioned.user.global_account_id || null,
        provisioned_created: provisioned.created,
        client_id: client.client_id,
      },
    })

    const html = renderOAuthBridgeHtml({
      accessToken: tokens.accessToken,
      email: provisioned.user.email,
      redirectPath: continuePath || '/account',
    })
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    deleteCookie(event, 'sso_oauth_state', { path: '/' })
    return sendRedirect(
      event,
      buildLoginPath({
        message: getErrorMessage(error),
        continuePath,
        clientId: parsedState.client_id,
      }),
      302,
    )
  }
})
