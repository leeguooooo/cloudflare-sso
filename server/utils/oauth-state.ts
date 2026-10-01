import { createError, H3Event } from 'h3'
import { randomId } from './crypto'
import { getDb } from './env'
import { ensureGlobalIdentitySchema } from './identity'

/**
 * OAuth state lives server side (D1 `oauth_states`). The browser only carries the
 * random state value in an httpOnly cookie, which binds the callback to the browser
 * that started the flow. Nothing security relevant (the account being linked, the
 * client, the continue path) can be edited by the user any more — the previous
 * design kept the whole payload in a plain JSON cookie.
 */

export const OAUTH_STATE_COOKIE = 'sso_oauth_state'
export const OAUTH_STATE_TTL_SECONDS = 600

export type OAuthStatePayload = {
  state: string
  provider: string
  client_id: string
  continue: string
  intent: 'login' | 'link'
  /** For intent=link: the global account the provider identity is attached to. */
  link_global_account_id?: string
  /** OIDC nonce sent to the provider (Apple). */
  nonce?: string
  created_at: number
}

export const createOAuthState = async (
  event: H3Event,
  input: Omit<OAuthStatePayload, 'state' | 'created_at'>,
): Promise<OAuthStatePayload> => {
  await ensureGlobalIdentitySchema(event)
  const now = Math.floor(Date.now() / 1000)
  const payload: OAuthStatePayload = { ...input, state: randomId(24), created_at: now }
  const db = getDb(event)
  await db
    .prepare(`INSERT INTO oauth_states (state, payload_json, expires_at) VALUES (?, ?, ?)`)
    .bind(payload.state, JSON.stringify(payload), now + OAUTH_STATE_TTL_SECONDS)
    .run()
  // Opportunistic cleanup of abandoned flows.
  await db.prepare(`DELETE FROM oauth_states WHERE expires_at < ?`).bind(now).run()
  return payload
}

/** Generic short-lived server record (e.g. an Apple form_post waiting for its GET). */
export const putTransient = async (event: H3Event, key: string, value: unknown, ttlSeconds = OAUTH_STATE_TTL_SECONDS) => {
  await ensureGlobalIdentitySchema(event)
  const now = Math.floor(Date.now() / 1000)
  await getDb(event)
    .prepare(`INSERT OR REPLACE INTO oauth_states (state, payload_json, expires_at) VALUES (?, ?, ?)`)
    .bind(key, JSON.stringify(value), now + ttlSeconds)
    .run()
}

/** Reads and deletes (single use). Returns null when missing or expired. */
export const takeTransient = async <T>(event: H3Event, key: string): Promise<T | null> => {
  await ensureGlobalIdentitySchema(event)
  const db = getDb(event)
  const row = await db
    .prepare(`SELECT payload_json, expires_at FROM oauth_states WHERE state = ?`)
    .bind(key)
    .first<{ payload_json: string; expires_at: number }>()
  if (!row) return null
  await db.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(key).run()
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null
  try {
    return JSON.parse(row.payload_json) as T
  } catch {
    return null
  }
}

/**
 * Validates the callback's `state` against the browser cookie and the stored record,
 * and consumes it. Throws 400 with a user-presentable message otherwise.
 */
export const consumeOAuthState = async (
  event: H3Event,
  input: { state: string; cookieState: string | undefined; provider: string },
): Promise<OAuthStatePayload> => {
  if (!input.state || !input.cookieState) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state expired, please try again' })
  }
  if (input.cookieState !== input.state) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state mismatch, please try again' })
  }
  const payload = await takeTransient<OAuthStatePayload>(event, input.state)
  if (!payload?.state || payload.state !== input.state || !payload.client_id) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state expired, please try again' })
  }
  if (payload.provider !== input.provider) {
    throw createError({ statusCode: 400, statusMessage: 'OAuth state mismatch, please try again' })
  }
  return payload
}
