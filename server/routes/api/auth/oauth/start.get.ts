import { createError, defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'
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
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  const authorizeUrl = buildOAuthAuthorizeUrl(event, provider, state)
  return sendRedirect(event, authorizeUrl, 302)
})
