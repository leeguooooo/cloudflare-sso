import {
  H3Event,
  createError,
  defineEventHandler,
  getCookie,
  getQuery,
  getRequestHeader,
  getRequestURL,
  sendRedirect,
  setCookie,
} from 'h3'
import { randomId } from '../../../../utils/crypto'
import { ensureGlobalIdentitySchema, getClientByPublicId } from '../../../../utils/identity'
import { buildOAuthAuthorizeUrl, parseOAuthProvider } from '../../../../utils/oauth'
import { getSessionByRefreshToken } from '../../../../utils/auth'
import { getDb } from '../../../../utils/env'

type StartState = {
  state: string
  provider: string
  client_id: string
  continue: string
  intent?: 'login' | 'link'
  link_global_account_id?: string
  created_at: number
}

const resolveContinuePath = (raw: unknown) => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/')) return ''
  if (value.startsWith('//')) return ''
  return value
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

const isSecureCookie = (event: H3Event) => {
  const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  if (forwardedProto) {
    return forwardedProto === 'https'
  }
  return getRequestURL(event).protocol === 'https:'
}

const buildLoginRedirect = (input: { clientId: string; continuePath: string; message: string }) => {
  const params = new URLSearchParams()
  params.set('oauth_error', input.message)
  if (input.clientId) {
    params.set('client_id', input.clientId)
  }
  const continuePath = resolveContinuePath(input.continuePath)
  if (continuePath) {
    params.set('continue', continuePath)
  }
  return `/login?${params.toString()}`
}

const buildAccountRedirect = (continuePath: string, message: string) => {
  const safePath = resolveContinuePath(continuePath) || '/account?section=linked'
  const url = new URL(safePath, 'https://account.local')
  url.searchParams.set('link_error', message)
  return `${url.pathname}${url.search}`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const provider = parseOAuthProvider(query.provider)
  const clientId = String(query.client_id || '').trim()
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'client_id required' })
  }

  await ensureGlobalIdentitySchema(event)
  const client = await getClientByPublicId(event, clientId)
  const state = randomId(24)
  const continuePath = resolveContinuePath(query.continue)
  const intent = query.intent === 'link' ? 'link' : 'login'

  let linkGlobalAccountId = ''
  if (intent === 'link') {
    const refreshToken = getCookie(event, 'sso_refresh_token') || ''
    if (!refreshToken) {
      throw createError({ statusCode: 401, statusMessage: 'Sign in required before linking provider' })
    }
    const session = await getSessionByRefreshToken(event, refreshToken)
    if (!session?.user_id) {
      throw createError({ statusCode: 401, statusMessage: 'Session expired, please sign in again' })
    }

    const db = getDb(event)
    const current = await db
      .prepare(`SELECT global_account_id FROM users WHERE id = ? AND tenant_id = ?`)
      .bind(session.user_id, session.tenant_id)
      .first<{ global_account_id?: string | null }>()
    if (!current?.global_account_id) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot link provider for this account' })
    }
    linkGlobalAccountId = current.global_account_id
  }

  const statePayload: StartState = {
    state,
    provider,
    client_id: client.client_id,
    continue: continuePath,
    intent,
    link_global_account_id: linkGlobalAccountId || undefined,
    created_at: Math.floor(Date.now() / 1000),
  }

  setCookie(event, 'sso_oauth_state', JSON.stringify(statePayload), {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  try {
    const authorizeUrl = buildOAuthAuthorizeUrl(event, provider, state)
    return sendRedirect(event, authorizeUrl, 302)
  } catch (error) {
    if (intent === 'link') {
      return sendRedirect(event, buildAccountRedirect(continuePath, getErrorMessage(error)), 302)
    }
    return sendRedirect(
      event,
      buildLoginRedirect({
        message: getErrorMessage(error),
        clientId: client.client_id,
        continuePath,
      }),
      302,
    )
  }
})
