import { defineEventHandler, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { getProviderAvailability } from '../../../utils/provider-policy'
import { isRecentAuth, listSignInMethods, sessionSignedInAt } from '../../../utils/sign-in-methods'
import { isAppleConfigured } from '../../../utils/apple'
import { getEnv } from '../../../utils/env'

/**
 * GET /api/account/sign-in-methods — the account's ways to sign in, which providers
 * can be linked from here, and whether the session is recent enough for changes.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const gaid = ctx.globalAccount?.id || ''
  const methods = gaid ? await listSignInMethods(event, gaid) : []
  const signedInAt = await sessionSignedInAt(event, ctx.currentSessionId)
  const env = getEnv(event)
  // Linking is offered for every configured provider; the login-page policy for
  // store clients does not apply on the account page.
  const visible = getProviderAvailability(event, { clientId: ctx.principal.aud || '', siwaPreview: true })
  return {
    email: ctx.globalAccount?.email || ctx.user.email,
    has_password: methods.some((method) => method.kind === 'password'),
    methods,
    linkable: {
      apple: isAppleConfigured(env) && visible.apple,
      google: Boolean((env.OAUTH_GOOGLE_CLIENT_ID || '').trim()),
      github: Boolean((env.OAUTH_GITHUB_CLIENT_ID || '').trim()),
    },
    recent_auth: isRecentAuth(signedInAt),
    signed_in_at: signedInAt,
  }
})
