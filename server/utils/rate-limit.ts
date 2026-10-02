import { createError, getRequestHeader, getRequestIP, H3Event, setResponseHeader } from 'h3'
import { getDb } from './env'
import { nowInSeconds } from './crypto'
import { oncePerDb } from './schema-once'

const WINDOW_SECONDS = 15 * 60
/** Failed sign-ins per email (any IP) and per IP (any email) inside the window. */
const MAX_FAILURES_PER_EMAIL = 10
const MAX_FAILURES_PER_IP = 50

/** Cloudflare sets cf-connecting-ip itself; x-forwarded-for can be supplied by the client. */
const clientIp = (event: H3Event) => getRequestHeader(event, 'cf-connecting-ip') || getRequestIP(event) || ''

const loginFailuresSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS login_failures (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         email TEXT NOT NULL,
         ip TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_login_failures_email ON login_failures (email, created_at)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures (ip, created_at)`).run()
})

const ensureSchema = (event: H3Event) => loginFailuresSchema(getDb(event))

/** Throws 429 when this email or IP has failed too often recently. */
export const assertLoginAllowed = async (event: H3Event, email: string) => {
  await ensureSchema(event)
  const since = nowInSeconds() - WINDOW_SECONDS
  const ip = clientIp(event)
  const row = await getDb(event)
    .prepare(
      `SELECT
         (SELECT count(*) FROM login_failures WHERE email = ? AND created_at > ?) AS by_email,
         (SELECT count(*) FROM login_failures WHERE ip = ? AND created_at > ?) AS by_ip`,
    )
    .bind(email, since, ip, since)
    .first<{ by_email: number; by_ip: number }>()
  if (Number(row?.by_email || 0) >= MAX_FAILURES_PER_EMAIL || (ip && Number(row?.by_ip || 0) >= MAX_FAILURES_PER_IP)) {
    setResponseHeader(event, 'retry-after', String(WINDOW_SECONDS))
    throw createError({ statusCode: 429, statusMessage: 'Too many failed sign-in attempts, try again later' })
  }
}

export const recordLoginFailure = async (event: H3Event, email: string) => {
  await ensureSchema(event)
  const db = getDb(event)
  const now = nowInSeconds()
  await db
    .prepare(`INSERT INTO login_failures (email, ip, created_at) VALUES (?, ?, ?)`)
    .bind(email, clientIp(event), now)
    .run()
  // Opportunistic pruning keeps the table tiny without a cron.
  if (Math.random() < 0.05) {
    await db.prepare(`DELETE FROM login_failures WHERE created_at < ?`).bind(now - WINDOW_SECONDS).run()
  }
}

/** A successful sign-in clears the email's counter so a typo streak does not linger. */
export const clearLoginFailures = async (event: H3Event, email: string) => {
  await ensureSchema(event)
  await getDb(event).prepare(`DELETE FROM login_failures WHERE email = ?`).bind(email).run()
}

const rateEventsSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rate_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         bucket TEXT NOT NULL,
         key TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_rate_events_lookup ON rate_events (bucket, key, created_at)`).run()
})

/**
 * Generic fixed-window limiter: records one hit for `bucket`/`key` and throws 429 when the
 * window already holds `max` hits. Use the client IP or an email as the key.
 */
export const consumeRateLimit = async (event: H3Event, bucket: string, key: string, max: number, windowSeconds: number) => {
  const db = getDb(event)
  await rateEventsSchema(db)
  const now = nowInSeconds()
  const row = await db
    .prepare(`SELECT count(*) AS n FROM rate_events WHERE bucket = ? AND key = ? AND created_at > ?`)
    .bind(bucket, key, now - windowSeconds)
    .first<{ n: number }>()
  if (Number(row?.n || 0) >= max) {
    setResponseHeader(event, 'retry-after', String(windowSeconds))
    throw createError({ statusCode: 429, statusMessage: 'Too many requests, try again later' })
  }
  await db.prepare(`INSERT INTO rate_events (bucket, key, created_at) VALUES (?, ?, ?)`).bind(bucket, key, now).run()
  if (Math.random() < 0.05) {
    await db.prepare(`DELETE FROM rate_events WHERE created_at < ?`).bind(now - 86400).run()
  }
}

export const requestIp = clientIp
