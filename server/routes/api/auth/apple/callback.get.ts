import { defineEventHandler, deleteCookie, getCookie, getQuery, getRequestURL, sendRedirect } from 'h3'
import { appleRedirectUri, exchangeAppleCode, requireAppleConfig } from '../../../../utils/apple'
import { buildLoginPath, completeOAuthSignIn, errorMessageOf, withQuery } from '../../../../utils/oauth-complete'
import { consumeOAuthState, OAUTH_STATE_COOKIE, takeTransient } from '../../../../utils/oauth-state'

type ApplePost = { code: string; state: string; user: string; error: string }

/** GET /api/auth/apple/callback?handle=… — second half of the Apple form_post (see callback.post.ts). */
export default defineEventHandler(async (event) => {
  const handle = String(getQuery(event).handle || '').trim()
  const posted = handle ? await takeTransient<ApplePost>(event, `apple-post:${handle}`) : null
  if (!posted) {
    deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })
    return sendRedirect(event, buildLoginPath({ message: 'Sign in with Apple expired, please try again' }), 302)
  }

  if (posted.error) {
    // user_cancelled_authorize etc. Still consume the state so it cannot be replayed.
    const cookieState = getCookie(event, OAUTH_STATE_COOKIE)
    const state = await consumeOAuthState(event, { state: posted.state, cookieState, provider: 'apple' }).catch(() => null)
    deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })
    if (state?.intent === 'link') {
      return sendRedirect(event, withQuery(state.continue || '/account?section=linked', { link_error: posted.error }), 302)
    }
    return sendRedirect(
      event,
      buildLoginPath({ message: posted.error === 'user_cancelled_authorize' ? '' : posted.error, continuePath: state?.continue, clientId: state?.client_id }),
      302,
    )
  }

  const state = await consumeOAuthState(event, {
    state: posted.state,
    cookieState: getCookie(event, OAUTH_STATE_COOKIE),
    provider: 'apple',
  })

  let profile
  try {
    const config = requireAppleConfig(event)
    const apple = await exchangeAppleCode(config, {
      code: posted.code,
      redirectUri: appleRedirectUri(event, getRequestURL(event).origin),
      nonce: state.nonce,
      userField: posted.user,
    })
    profile = {
      provider: 'apple' as const,
      subject: apple.subject,
      email: apple.email,
      emailVerified: apple.emailVerified,
      isPrivateEmail: apple.isPrivateEmail,
      name: apple.name,
      refreshToken: apple.refreshToken,
      profile: {},
    }
  } catch (error) {
    deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/' })
    return sendRedirect(
      event,
      state.intent === 'link'
        ? withQuery(state.continue || '/account?section=linked', { link_error: errorMessageOf(error) })
        : buildLoginPath({ message: errorMessageOf(error), continuePath: state.continue, clientId: state.client_id }),
      302,
    )
  }
  return completeOAuthSignIn(event, state, profile)
})
