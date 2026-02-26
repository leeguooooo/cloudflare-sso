import { createError, getRequestURL, H3Event } from 'h3'
import { getEnv } from './env'

export type OAuthProvider = 'github' | 'google' | 'wechat'

type ProviderConfig = {
  provider: OAuthProvider
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type OAuthIdentityProfile = {
  provider: OAuthProvider
  subject: string
  email?: string
  name?: string
  avatarUrl?: string
  profile: Record<string, unknown>
}

const PROVIDERS: OAuthProvider[] = ['github', 'google', 'wechat']

const normalizeEmail = (email: string | null | undefined) => {
  const value = (email || '').trim().toLowerCase()
  return value || undefined
}

export const parseOAuthProvider = (providerRaw: unknown): OAuthProvider => {
  const provider = String(providerRaw || '').trim().toLowerCase()
  if (!PROVIDERS.includes(provider as OAuthProvider)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported provider' })
  }
  return provider as OAuthProvider
}

const resolveRedirectUri = (event: H3Event, provider: OAuthProvider) => {
  const env = getEnv(event)
  if (provider === 'github') {
    const configured = (env.OAUTH_GITHUB_REDIRECT_URI || '').trim()
    if (configured) return configured
  }
  if (provider === 'google') {
    const configured = (env.OAUTH_GOOGLE_REDIRECT_URI || '').trim()
    if (configured) return configured
  }

  const requestUrl = getRequestURL(event)
  return `${requestUrl.origin}/api/auth/oauth/callback?provider=${encodeURIComponent(provider)}`
}

const getProviderConfig = (event: H3Event, provider: OAuthProvider): ProviderConfig => {
  const env = getEnv(event)
  if (provider === 'github') {
    const clientId = (env.OAUTH_GITHUB_CLIENT_ID || '').trim()
    const clientSecret = (env.OAUTH_GITHUB_CLIENT_SECRET || '').trim()
    if (!clientId || !clientSecret) {
      throw createError({ statusCode: 501, statusMessage: 'GitHub OAuth is not configured' })
    }
    return {
      provider,
      clientId,
      clientSecret,
      redirectUri: resolveRedirectUri(event, provider),
    }
  }

  if (provider === 'google') {
    const clientId = (env.OAUTH_GOOGLE_CLIENT_ID || '').trim()
    const clientSecret = (env.OAUTH_GOOGLE_CLIENT_SECRET || '').trim()
    if (!clientId || !clientSecret) {
      throw createError({ statusCode: 501, statusMessage: 'Google OAuth is not configured' })
    }
    return {
      provider,
      clientId,
      clientSecret,
      redirectUri: resolveRedirectUri(event, provider),
    }
  }

  throw createError({ statusCode: 501, statusMessage: 'WeChat OAuth is planned but not enabled yet' })
}

export const buildOAuthAuthorizeUrl = (event: H3Event, provider: OAuthProvider, state: string) => {
  const config = getProviderConfig(event, provider)

  if (provider === 'github') {
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.redirectUri)
    url.searchParams.set('scope', 'read:user user:email')
    url.searchParams.set('state', state)
    url.searchParams.set('allow_signup', 'true')
    return url.toString()
  }

  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.redirectUri)
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
    return url.toString()
  }

  throw createError({ statusCode: 501, statusMessage: 'WeChat OAuth is planned but not enabled yet' })
}

const requestJson = async <T>(response: Response) => {
  let payload: T | null = null
  try {
    payload = (await response.json()) as T
  } catch {
    payload = null
  }
  return payload
}

const exchangeGithubCode = async (event: H3Event, code: string) => {
  const config = getProviderConfig(event, 'github')

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  })
  const tokenPayload = await requestJson<{ access_token?: string; error?: string; error_description?: string }>(tokenResponse)
  const accessToken = tokenPayload?.access_token
  if (!tokenResponse.ok || !accessToken) {
    throw createError({
      statusCode: 401,
      statusMessage: tokenPayload?.error_description || tokenPayload?.error || 'Failed to exchange GitHub code',
    })
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'cloudflare-sso',
    },
  })
  const userPayload = await requestJson<Record<string, unknown>>(userResponse)
  if (!userResponse.ok || !userPayload) {
    throw createError({ statusCode: 401, statusMessage: 'Failed to load GitHub user profile' })
  }

  const subject = String(userPayload.id || '')
  if (!subject) {
    throw createError({ statusCode: 400, statusMessage: 'Missing GitHub subject' })
  }

  let email = normalizeEmail(typeof userPayload.email === 'string' ? userPayload.email : undefined)
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'cloudflare-sso',
      },
    })
    const emailPayload = await requestJson<Array<{ email?: string; verified?: boolean; primary?: boolean }>>(emailResponse)
    if (emailResponse.ok && Array.isArray(emailPayload)) {
      const preferred =
        emailPayload.find((item) => item.primary && item.verified) ||
        emailPayload.find((item) => item.verified) ||
        emailPayload.find((item) => item.email)
      email = normalizeEmail(preferred?.email)
    }
  }

  return {
    provider: 'github',
    subject,
    email,
    name: typeof userPayload.name === 'string' ? userPayload.name : undefined,
    avatarUrl: typeof userPayload.avatar_url === 'string' ? userPayload.avatar_url : undefined,
    profile: userPayload,
  } satisfies OAuthIdentityProfile
}

const exchangeGoogleCode = async (event: H3Event, code: string) => {
  const config = getProviderConfig(event, 'google')

  const tokenBody = new URLSearchParams()
  tokenBody.set('grant_type', 'authorization_code')
  tokenBody.set('code', code)
  tokenBody.set('client_id', config.clientId)
  tokenBody.set('client_secret', config.clientSecret)
  tokenBody.set('redirect_uri', config.redirectUri)

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: tokenBody.toString(),
  })
  const tokenPayload = await requestJson<{ access_token?: string; error?: string; error_description?: string }>(tokenResponse)
  const accessToken = tokenPayload?.access_token
  if (!tokenResponse.ok || !accessToken) {
    throw createError({
      statusCode: 401,
      statusMessage: tokenPayload?.error_description || tokenPayload?.error || 'Failed to exchange Google code',
    })
  }

  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })
  const userPayload = await requestJson<Record<string, unknown>>(userResponse)
  if (!userResponse.ok || !userPayload) {
    throw createError({ statusCode: 401, statusMessage: 'Failed to load Google user profile' })
  }

  const subject = String(userPayload.sub || '')
  if (!subject) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Google subject' })
  }

  return {
    provider: 'google',
    subject,
    email: normalizeEmail(typeof userPayload.email === 'string' ? userPayload.email : undefined),
    name: typeof userPayload.name === 'string' ? userPayload.name : undefined,
    avatarUrl: typeof userPayload.picture === 'string' ? userPayload.picture : undefined,
    profile: userPayload,
  } satisfies OAuthIdentityProfile
}

export const getOAuthIdentityProfile = async (
  event: H3Event,
  input: {
    provider: OAuthProvider
    code: string
  },
) => {
  if (input.provider === 'github') {
    return exchangeGithubCode(event, input.code)
  }
  if (input.provider === 'google') {
    return exchangeGoogleCode(event, input.code)
  }
  throw createError({ statusCode: 501, statusMessage: 'WeChat OAuth is planned but not enabled yet' })
}
