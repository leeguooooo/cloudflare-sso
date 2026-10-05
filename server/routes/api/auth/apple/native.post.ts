import { defineEventHandler, H3Event, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { appleIdentityFromClaims, appleNonceHash, exchangeNativeAppleCode, requireAppleConfig, verifyAppleJwt } from '../../../../utils/apple'
import { getEnv } from '../../../../utils/env'
import { ensureGlobalIdentitySchema, getClientByPublicId } from '../../../../utils/identity'
import { AccountExistsError, errorMessageOf, resolveLoginAccount, signInAccount } from '../../../../utils/oauth-complete'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'
import type { OAuthIdentityProfile } from '../../../../utils/oauth'

type NativeAppleBody = {
  client_id?: unknown
  identity_token?: unknown
  nonce?: unknown
  authorization_code?: unknown
  given_name?: unknown
  family_name?: unknown
}

const ERROR_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_token',
  403: 'access_denied',
  429: 'too_many_requests',
  501: 'not_configured',
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const fail = (event: H3Event, status: number, error: string, description: string, extra: Record<string, unknown> = {}) => {
  setResponseStatus(event, status)
  return { error, error_description: description, ...extra }
}

/**
 * POST /api/auth/apple/native { client_id, identity_token, nonce, authorization_code?, given_name?, family_name? }
 *
 * Sign in with Apple from a native app (ASAuthorizationAppleIDProvider). The identity token must
 * be issued to one of APPLE_APP_IDS and carry nonce = hex(SHA-256(nonce)). When the app also sends
 * the authorization code it is redeemed for an Apple refresh token (kept so account deletion can
 * revoke it); that step never fails the sign-in. Responds like /token, or `{ error, error_description }`.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const body = ((await readBody(event).catch(() => ({}))) || {}) as NativeAppleBody
  const clientId = str(body.client_id)
  const identityToken = str(body.identity_token)
  const nonce = str(body.nonce)
  if (!clientId || !identityToken || !nonce) {
    return fail(event, 400, 'invalid_request', 'client_id, identity_token and nonce are required')
  }

  try {
    await consumeRateLimit(event, 'apple_native', requestIp(event), 60, 600)
    if (String(getEnv(event).SIWA_ENABLED || '').trim() === '0') {
      return fail(event, 501, 'not_configured', 'Sign in with Apple is disabled')
    }
    const config = requireAppleConfig(event)

    await ensureGlobalIdentitySchema(event)
    const client = await getClientByPublicId(event, clientId).catch((error) => {
      throw Object.assign(error, { oauthError: 'invalid_client' })
    })
    const claims = await verifyAppleJwt(config, identityToken, { audiences: config.appIds, nonce: await appleNonceHash(nonce) })
    const name = [str(body.given_name), str(body.family_name)].filter(Boolean).join(' ')
    const apple = appleIdentityFromClaims(claims, { name: name || undefined })
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    const appleClientId = String(audiences.find((aud) => typeof aud === 'string' && config.appIds.includes(aud)) || '')

    const profile: OAuthIdentityProfile = {
      provider: 'apple',
      subject: apple.subject,
      email: apple.email,
      emailVerified: apple.emailVerified,
      isPrivateEmail: apple.isPrivateEmail,
      name: apple.name,
      profile: {},
    }

    const code = str(body.authorization_code)
    if (code && appleClientId) {
      try {
        const exchanged = await exchangeNativeAppleCode(config, { code, clientId: appleClientId, subject: apple.subject })
        if (exchanged.refreshToken) {
          profile.refreshToken = exchanged.refreshToken
          profile.refreshTokenClientId = appleClientId
        }
      } catch (error) {
        console.warn('apple native code exchange failed', { apple_client_id: appleClientId, error: errorMessageOf(error) })
      }
    }

    const account = await resolveLoginAccount(event, profile)
    const { provisioned, tokens } = await signInAccount(event, client, account, profile)

    await writeAuditLog(event, {
      tenantId: provisioned.user.tenant_id,
      userId: provisioned.user.id,
      action: 'auth.apple_native',
      payload: {
        client_id: client.client_id,
        apple_client_id: appleClientId,
        global_account_id: account.id,
        provisioned_created: provisioned.created,
        apple_refresh_token_stored: Boolean(profile.refreshToken),
      },
    })

    return {
      token_type: 'Bearer',
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.accessTokenExpiresIn,
      scope: client.scope || 'openid profile email',
    }
  } catch (error) {
    if (error instanceof AccountExistsError) {
      return fail(
        event,
        409,
        'account_exists',
        `${error.email} is already registered with another sign-in method. Sign in with that method, then link Apple under Account → Sign-in methods.`,
        { email: error.email },
      )
    }
    const status = Number((error as { statusCode?: number })?.statusCode) || 500
    if (status >= 500 && status !== 501 && status !== 502) {
      console.error('apple native sign-in failed', { error: errorMessageOf(error) })
      return fail(event, 500, 'server_error', 'Sign in with Apple failed')
    }
    const code = (error as { oauthError?: string }).oauthError || ERROR_BY_STATUS[status] || (status === 502 ? 'server_error' : 'invalid_request')
    return fail(event, status, code, errorMessageOf(error))
  }
})
