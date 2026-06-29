import { defineEventHandler, getRequestURL } from 'h3'
import { getEnv } from '../../utils/env'
import { getIssuer } from '../../utils/auth'

// RFC 9728 — OAuth 2.0 Protected Resource Metadata. Declares this origin as a
// protected resource and points at its authorization server (this IdP), so
// agents can discover how to obtain tokens for it.
export default defineEventHandler((event) => {
  const env = getEnv(event)
  const origin = getRequestURL(event).origin
  const issuer = getIssuer(event, env)
  const base = issuer || origin

  return {
    resource: base,
    authorization_servers: [base],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  }
})
