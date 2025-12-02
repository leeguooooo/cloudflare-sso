import { defineEventHandler, getRequestURL } from 'h3'
import { getEnv } from '../../utils/env'
import { getIssuer } from '../../utils/auth'

export default defineEventHandler((event) => {
  const env = getEnv(event)
  const origin = getRequestURL(event).origin
  const issuer = getIssuer(event, env)
  const base = issuer || origin

  const authorizationEndpoint = `${base}/authorize`
  const tokenEndpoint = `${base}/token`
  const userinfoEndpoint = `${base}/userinfo`
  const jwksEndpoint = `${base}/jwks.json`

  return {
    issuer: base,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    userinfo_endpoint: userinfoEndpoint,
    jwks_uri: jwksEndpoint,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  }
})
