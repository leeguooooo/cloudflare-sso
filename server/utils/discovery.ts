import { getRequestURL, H3Event } from 'h3'
import { getEnv } from './env'
import { getIssuer } from './auth'
import { DEVICE_CODE_GRANT } from './device'

/** Shared by /.well-known/openid-configuration and the RFC 8414 OAuth metadata document. */
export const buildServerMetadata = (event: H3Event) => {
  const env = getEnv(event)
  const base = getIssuer(event, env) || getRequestURL(event).origin
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    userinfo_endpoint: `${base}/userinfo`,
    jwks_uri: `${base}/jwks.json`,
    revocation_endpoint: `${base}/revoke`,
    end_session_endpoint: `${base}/logout`,
    device_authorization_endpoint: `${base}/device/code`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials', DEVICE_CODE_GRANT],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    prompt_values_supported: ['none', 'login'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'sid', 'email', 'email_verified', 'name', 'picture', 'locale'],
  }
}
