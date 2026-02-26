import { createError, H3Event } from 'h3'

type EnvBindings = {
  DB: D1Database
  JWT_PRIVATE_KEY?: string
  JWT_KID?: string
  JWT_ISSUER?: string
  PASSWORD_PEPPER?: string
  ACCESS_TOKEN_TTL_SECONDS?: string
  REFRESH_TOKEN_TTL_SECONDS?: string
  OAUTH_GITHUB_CLIENT_ID?: string
  OAUTH_GITHUB_CLIENT_SECRET?: string
  OAUTH_GITHUB_REDIRECT_URI?: string
  OAUTH_GOOGLE_CLIENT_ID?: string
  OAUTH_GOOGLE_CLIENT_SECRET?: string
  OAUTH_GOOGLE_REDIRECT_URI?: string
  DEFAULT_CLIENT_ID?: string
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
