import { createError, defineEventHandler, getCookie, getQuery, getRequestURL, sendRedirect, setCookie } from 'h3'
import { randomId } from '../../../../utils/crypto'
import { ensureGlobalIdentitySchema, getClientByPublicId } from '../../../../utils/identity'
import { buildOAuthAuthorizeUrl, parseOAuthProvider } from '../../../../utils/oauth'
import { getSessionByRefreshToken } from '../../../../utils/auth'
import { getDb, getEnv } from '../../../../utils/env'
import { appleRedirectUri, buildAppleAuthorizeUrl, requireAppleConfig } from '../../../../utils/apple'
import { buildLoginPath, errorMessageOf, isSecureRequest, safeContinue, withQuery } from '../../../../utils/oauth-complete'
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from '../../../../utils/oauth-state'
import { isWechatWebEnabled } from '../../../../utils/wechat'
import { getProviderAvailability } from '../../../../utils/provider-policy'
import { isRecentAuth, REAUTH_REQUIRED } from '../../../../utils/sign-in-methods'

/**
 * GET /api/auth/oauth/start?provider=apple|google|github&client_id=…[&continue=…][&intent=link][&siwa=1]
 *
 * intent=login: the provider must be offered to this client (provider-policy).
 * intent=link: requires the refresh cookie of a session signed in within the last
 * 15 minutes; the account to link to is stored server side with the state.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const provider = parseOAuthProvider(query.provider)
  const clientId = String(query.client_id || '').trim()
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'client_id required' })
  }

  await ensureGlobalIdentitySchema(event)
  const client = await getClientByPublicId(event, clientId)
  const continuePath = safeContinue(query.continue)
  const intent = query.intent === 'link' ? 'link' : 'login'
  const linkBack = (message: string) => withQuery(continuePath || '/account?section=linked', { link_error: message })

  try {
    let linkGlobalAccountId = ''
    if (intent === 'link') {
      const refreshToken = getCookie(event, 'sso_refresh_token') || ''
      const session = refreshToken ? await getSessionByRefreshToken(event, refreshToken) : null
      if (!session?.user_id) {
        throw createError({ statusCode: 401, statusMessage: 'Sign in required before linking provider' })
      }
      if (!isRecentAuth(Number((session as { created_at?: number }).created_at || 0))) {
        return sendRedirect(event, linkBack(REAUTH_REQUIRED), 302)
      }
      const current = await getDb(event)
        .prepare(`SELECT global_account_id FROM users WHERE id = ? AND tenant_id = ?`)
        .bind(session.user_id, session.tenant_id)
        .first<{ global_account_id?: string | null }>()
      if (!current?.global_account_id) {
        throw createError({ statusCode: 400, statusMessage: 'Cannot link provider for this account' })
      }
      linkGlobalAccountId = current.global_account_id
      if (provider === 'apple' && !getProviderAvailability(event, { clientId: client.client_id, siwaPreview: true }).apple) {
        throw createError({ statusCode: 403, statusMessage: 'Sign in with Apple is not available yet' })
      }
    } else {
      const available = getProviderAvailability(event, { clientId: client.client_id, siwaPreview: query.siwa === '1' })
      // WeChat is third-party sign-in too: same store-client rule as Google (Guideline 4.8).
      const allowed = provider === 'wechat' ? isWechatWebEnabled(getEnv(event)) && available.google : available[provider as 'apple' | 'google' | 'github']
      if (!allowed) {
        throw createError({ statusCode: 403, statusMessage: 'This sign-in method is not available here' })
      }
    }

    const nonce = provider === 'apple' ? randomId(24) : undefined
    const statePayload = await createOAuthState(event, {
      provider,
      client_id: client.client_id,
      continue: continuePath,
      intent,
      link_global_account_id: linkGlobalAccountId || undefined,
      nonce,
    })

    setCookie(event, OAUTH_STATE_COOKIE, statePayload.state, {
      httpOnly: true,
      secure: isSecureRequest(event),
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    })

    const authorizeUrl =
      provider === 'apple'
        ? buildAppleAuthorizeUrl(requireAppleConfig(event), {
            redirectUri: appleRedirectUri(event, getRequestURL(event).origin),
            state: statePayload.state,
            nonce: nonce || '',
          })
        : buildOAuthAuthorizeUrl(event, provider, statePayload.state)
    return sendRedirect(event, authorizeUrl, 302)
  } catch (error) {
    if (intent === 'link') {
      return sendRedirect(event, linkBack(errorMessageOf(error)), 302)
    }
    return sendRedirect(
      event,
      buildLoginPath({ message: errorMessageOf(error), clientId: client.client_id, continuePath }),
      302,
    )
  }
})
