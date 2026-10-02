import { createError, H3Event } from 'h3'

type EnvBindings = {
  DB: D1Database
  JWT_PRIVATE_KEY?: string
  JWT_KID?: string
  JWT_ISSUER?: string
  PASSWORD_PEPPER?: string
  /** Secret pepper for `pbkdf2v2$` hashes; legacy hashes (PASSWORD_PEPPER) migrate on sign-in. */
  PASSWORD_PEPPER_V2?: string
  /** Resend API key + verified sender, e.g. "leeguoo <account@leeguoo.com>". */
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  /** "log" = print emails instead of sending (local dev / tests). */
  EMAIL_TRANSPORT?: string
  /** WeChat open-platform website app (QR code sign-in). */
  WECHAT_WEB_APP_ID?: string
  WECHAT_WEB_APP_SECRET?: string
  /** JSON: SSO client_id → { appid } for mini-programs; secrets in WECHAT_MP_SECRET_<APPID>. */
  WECHAT_MINIPROGRAMS?: string
  /** Shared secret of the billing reconcile cron worker. */
  RECONCILE_SECRET?: string
  ACCESS_TOKEN_TTL_SECONDS?: string
  REFRESH_TOKEN_TTL_SECONDS?: string
  OAUTH_GITHUB_CLIENT_ID?: string
  OAUTH_GITHUB_CLIENT_SECRET?: string
  OAUTH_GITHUB_REDIRECT_URI?: string
  OAUTH_GOOGLE_CLIENT_ID?: string
  OAUTH_GOOGLE_CLIENT_SECRET?: string
  OAUTH_GOOGLE_REDIRECT_URI?: string
  DEFAULT_CLIENT_ID?: string
  /** Extra comma-separated client ids (besides DEFAULT_CLIENT_ID) whose tokens may use the admin APIs. */
  ADMIN_CLIENT_IDS?: string
  /** Tenant whose admins may bootstrap apps; defaults to the tenant of DEFAULT_CLIENT_ID. */
  PLATFORM_TENANT_ID?: string
  /** Absolute session lifetime regardless of refreshes (default one year). */
  SESSION_MAX_AGE_SECONDS?: string
  /** Sign in with Apple: "1" = on for every client, "test" = only when the page URL has ?siwa=1, else off. */
  SIWA_ENABLED?: string
  /** "1" = show Google / GitHub to native App Store clients too (only ever when Apple is available). */
  STORE_CLIENTS_SOCIAL_LOGIN?: string
  /** Extra comma-separated client ids treated as native App Store clients (server side). */
  NATIVE_STORE_CLIENT_IDS?: string
  APPLE_TEAM_ID?: string
  APPLE_SERVICES_ID?: string
  APPLE_KEY_ID?: string
  /** Contents of the AuthKey_XXXX.p8 file (PKCS#8 PEM). */
  APPLE_PRIVATE_KEY?: string
  /** Comma-separated App IDs whose server-to-server notifications are accepted (default com.paste.native). */
  APPLE_APP_IDS?: string
  /** Optional override of the redirect URI registered on the Services ID. */
  APPLE_REDIRECT_URI?: string
  /** Test-only override of https://appleid.apple.com (local mock provider). */
  APPLE_AUTH_BASE_URL?: string
  /** Served at /.well-known/apple-developer-domain-association.txt when set. */
  APPLE_DOMAIN_ASSOCIATION?: string
  /** Comma-separated base URLs of connected apps' account hooks (…/merge, …/delete are appended). */
  ACCOUNT_HOOK_URLS?: string
  /** Shared bearer secret sent to the account hooks. */
  ACCOUNT_HOOK_SECRET?: string
}

export const getEnv = (event: H3Event): EnvBindings => {
  // Cloudflare Pages/Workers environment
  const cloudflareEnv = event.context?.cloudflare?.env || (event as any).context?.env
  if (cloudflareEnv) {
    return cloudflareEnv as EnvBindings
  }
  // Fallback to process.env for local development
  if (process.env) {
    return process.env as EnvBindings
  }
  throw createError({ statusCode: 500, statusMessage: 'Missing Cloudflare env bindings' })
}

export const getDb = (event: H3Event) => {
  const env = getEnv(event)
  if (!env.DB) {
    throw createError({ statusCode: 500, statusMessage: 'D1 binding DB not configured' })
  }
  return env.DB
}
