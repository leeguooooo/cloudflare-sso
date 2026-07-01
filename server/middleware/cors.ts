import { defineEventHandler, getRequestHeader, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'

/**
 * Credentialed CORS for first-party leeguoo.com properties.
 *
 * Static first-party SPAs on other subdomains (e.g. chrome-use.leeguoo.com on
 * GitHub Pages) complete the OIDC PKCE flow entirely in the browser, so they
 * must be able to READ the cross-origin responses of /token, /userinfo and the
 * billing/entitlements API. They are same-SITE (leeguoo.com), so the account
 * session cookie already rides along; the only missing piece is the CORS
 * response headers that let the SPA read the body.
 *
 * Scope is intentionally narrow: only exact `https://<sub>.leeguoo.com` origins
 * (plus localhost for dev) are echoed back with credentials. Non-allowlisted
 * origins get no CORS headers at all — behaviour for the account UI and
 * server-to-server clients is unchanged.
 */
const ALLOWED_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.leeguoo\.com$/
const isDevOrigin = (origin: string) => /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)

const isAllowedOrigin = (origin: string): boolean =>
  ALLOWED_ORIGIN_RE.test(origin) || isDevOrigin(origin)

// Only these API paths are opened up for cross-origin credentialed reads.
const CORS_PATHS = new Set<string>(['/token', '/userinfo', '/api/billing/entitlements'])

export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, 'origin') || ''
  if (!origin || !isAllowedOrigin(origin)) return

  const path = getRequestURL(event).pathname
  if (!CORS_PATHS.has(path)) return

  setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
  setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')
  setResponseHeader(event, 'Vary', 'Origin')

  if (event.method === 'OPTIONS') {
    setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')
    setResponseHeader(event, 'Access-Control-Max-Age', '86400')
    setResponseStatus(event, 204)
    return ''
  }
})
