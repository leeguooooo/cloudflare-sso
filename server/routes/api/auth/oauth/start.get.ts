import { H3Event, createError, defineEventHandler, getQuery, getRequestHeader, getRequestURL, sendRedirect, setCookie } from 'h3'
import { randomId } from '../../../../utils/crypto'
import { ensureGlobalIdentitySchema, getClientByPublicId } from '../../../../utils/identity'
import { buildOAuthAuthorizeUrl, parseOAuthProvider } from '../../../../utils/oauth'

type StartState = {
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

  const statePayload: StartState = {
    state,
    provider,
    client_id: client.client_id,
    continue: continuePath,
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
