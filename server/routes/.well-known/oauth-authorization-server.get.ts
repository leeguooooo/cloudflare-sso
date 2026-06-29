import { defineEventHandler, getRequestURL } from 'h3'
import { getEnv } from '../../utils/env'
import { getIssuer } from '../../utils/auth'

// RFC 8414 — OAuth 2.0 Authorization Server Metadata. Mirrors the OIDC
// discovery document so agents/clients that probe the OAuth (rather than
// OpenID) well-known endpoint get valid JSON metadata instead of the SPA HTML.
export default defineEventHandler((event) => {
  const env = getEnv(event)
  const origin = getRequestURL(event).origin
  const issuer = getIssuer(event, env)
  const base = issuer || origin

  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    userinfo_endpoint: `${base}/userinfo`,
    jwks_uri: `${base}/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
  }
})
