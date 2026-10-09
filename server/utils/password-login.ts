import { createError, H3Event, setCookie } from 'h3'
import { issueTokens } from './auth'
import { getUserRolesForClient } from './access'
import { writeAuditLog } from './audit'
import { clearLoginFailures } from './rate-limit'
import { getClientByPublicId, provisionTenantUserForGlobalAccount, type GlobalAccountRecord } from './identity'

type Client = Awaited<ReturnType<typeof getClientByPublicId>>

/**
 * Last step of an email + password sign-in, once every factor has been checked: provisions
 * the client's tenant user, opens the session (refresh cookie + tokens) and audits it.
 * Shared by /api/auth/login, /api/auth/mfa/verify (two-step accounts) and /api/auth/passkey/verify.
 */
export const completePasswordSignIn = async (
  event: H3Event,
  client: Client,
  globalAccount: GlobalAccountRecord,
  loginEmail: string,
  secondFactor?: 'totp' | 'recovery' | 'passkey',
) => {
  if (globalAccount.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
  }
  await clearLoginFailures(event, loginEmail)

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
  const tokens = await issueTokens(event, provisioned.user, client, client.scope || 'openid profile email', { roles })

  setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(tokens.refreshTokenExpiresAt * 1000),
  })

  await writeAuditLog(event, {
    tenantId: provisioned.user.tenant_id,
    userId: provisioned.user.id,
    action: 'auth.login',
    payload: {
      client_id: client.client_id,
      global_account_id: provisioned.user.global_account_id || null,
      provisioned_created: provisioned.created,
      ...(secondFactor ? { second_factor: secondFactor } : {}),
    },
  })

  return {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.accessTokenExpiresIn,
    scope: client.scope,
    user: {
      id: provisioned.user.id,
      email: provisioned.user.email,
      tenant_id: provisioned.user.tenant_id,
      locale: provisioned.user.locale,
      global_account_id: provisioned.user.global_account_id,
    },
  }
}
