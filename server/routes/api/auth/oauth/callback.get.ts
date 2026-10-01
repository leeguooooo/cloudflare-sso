import { createError, defineEventHandler, deleteCookie, getCookie, getQuery, sendRedirect } from 'h3'
import { getOAuthIdentityProfile, parseOAuthProvider } from '../../../../utils/oauth'
import { buildLoginPath, completeOAuthSignIn, errorMessageOf } from '../../../../utils/oauth-complete'
import { consumeOAuthState, OAUTH_STATE_COOKIE } from '../../../../utils/oauth-state'

/** GET /api/auth/oauth/callback?provider=google|github — Apple uses /api/auth/apple/callback. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const provider = parseOAuthProvider(query.provider)
  if (provider === 'apple') {
    throw createError({ statusCode: 400, statusMessage: 'Apple uses /api/auth/apple/callback' })
  }
  const code = String(query.code || '').trim()
  const state = String(query.state || '').trim()

  const providerError = String(query.error || '').trim()
  if (providerError) {
    deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })
    const errorDescription = String(query.error_description || providerError).trim()
    return sendRedirect(event, buildLoginPath({ message: errorDescription }), 302)
  }
  if (!code || !state) {
    throw createError({ statusCode: 400, statusMessage: 'code and state required' })
  }

  const payload = await consumeOAuthState(event, { state, cookieState: getCookie(event, OAUTH_STATE_COOKIE), provider })

  let profile
  try {
    profile = await getOAuthIdentityProfile(event, { provider, code })
  } catch (error) {
    deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })
    return sendRedirect(
      event,
      payload.intent === 'link'
        ? `/account?section=linked&link_error=${encodeURIComponent(errorMessageOf(error))}`
        : buildLoginPath({ message: errorMessageOf(error), continuePath: payload.continue, clientId: payload.client_id }),
      302,
    )
  }
  return completeOAuthSignIn(event, payload, profile)
})
