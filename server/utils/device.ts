/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628), for input-constrained devices (Apple TV).
 *
 * - POST /device/code: the device gets a device_code (kept secret, stored as a hash) and a short
 *   user_code it shows on screen together with `${issuer}/device`.
 * - The user opens /device on a phone or computer, signs in with the hosted login page and
 *   approves or denies the code (POST /api/auth/device/verify, first-party session cookie only).
 * - The device polls /token with grant_type=urn:ietf:params:oauth:grant-type:device_code until
 *   the code is approved (tokens issued exactly once), denied or expired.
 */
import { H3Event } from 'h3'
import { clientAppName, clientDeviceName } from '../../utils/auth-client'
import { getBrowserSessionAccount } from './browser-session'
import { getDb } from './env'
import { hashToken, nowInSeconds, randomId } from './crypto'
import { oncePerDb } from './schema-once'

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
export const DEVICE_CODE_TTL_SECONDS = 600
export const DEVICE_POLL_INTERVAL_SECONDS = 5

/** No vowels (no words), no 0/O/1/I lookalikes: 20 letters, 8 of them ≈ 2.6e10 codes. */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const USER_CODE_LENGTH = 8

export type DeviceCodeRow = {
  id: string
  device_code_hash: string
  user_code: string
  client_id: string
  scope: string
  status: 'pending' | 'approved' | 'denied' | 'consumed'
  global_account_id: string | null
  auth_time: number | null
  poll_interval: number
  last_polled_ms: number | null
  expires_at: number
  approved_at: number | null
  consumed_at: number | null
  created_at: number
}

const deviceSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS device_codes (
        id TEXT PRIMARY KEY,
        device_code_hash TEXT NOT NULL UNIQUE,
        user_code TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
        global_account_id TEXT,
        auth_time INTEGER,
        poll_interval INTEGER NOT NULL DEFAULT 5,
        last_polled_ms INTEGER,
        expires_at INTEGER NOT NULL,
        approved_at INTEGER,
        consumed_at INTEGER,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
      )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes (expires_at)`).run()
})

export const ensureDeviceCodeSchema = (event: H3Event) => deviceSchema(getDb(event))

export const generateUserCode = () => {
  let out = ''
  while (out.length < USER_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 240 = 12 * 20: rejecting the tail keeps every letter equally likely.
      if (byte < 240 && out.length < USER_CODE_LENGTH) out += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]
    }
  }
  return out
}

/** What users type: any case, with or without the dash or spaces. Returns '' when it cannot be a code. */
export const normalizeUserCode = (raw: unknown) => {
  const value = (typeof raw === 'string' ? raw : '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (value.length !== USER_CODE_LENGTH) return ''
  for (const char of value) if (!USER_CODE_ALPHABET.includes(char)) return ''
  return value
}

export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

export const createDeviceCode = async (
  event: H3Event,
  input: { clientInternalId: string; scope: string; ip: string; userAgent: string },
) => {
  await ensureDeviceCodeSchema(event)
  const db = getDb(event)
  const now = nowInSeconds()
  if (Math.random() < 0.05) {
    await db.prepare(`DELETE FROM device_codes WHERE expires_at < ?`).bind(now - 86400).run()
  }
  const deviceCode = randomId(32)
  const deviceCodeHash = await hashToken(deviceCode)
  for (let attempt = 0; ; attempt += 1) {
    const userCode = generateUserCode()
    // A finished code keeps its user_code until pruned; free it if it collides.
    await db.prepare(`DELETE FROM device_codes WHERE user_code = ? AND expires_at < ?`).bind(userCode, now).run()
    try {
      await db
        .prepare(
          `INSERT INTO device_codes (id, device_code_hash, user_code, client_id, scope, poll_interval, expires_at, ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          deviceCodeHash,
          userCode,
          input.clientInternalId,
          input.scope,
          DEVICE_POLL_INTERVAL_SECONDS,
          now + DEVICE_CODE_TTL_SECONDS,
          input.ip,
          input.userAgent,
        )
        .run()
      return { deviceCode, userCode, expiresIn: DEVICE_CODE_TTL_SECONDS, interval: DEVICE_POLL_INTERVAL_SECONDS }
    } catch (error) {
      if (attempt >= 4 || !/unique/i.test(String((error as Error)?.message || error))) throw error
    }
  }
}

export const findDeviceCodeByUserCode = async (event: H3Event, userCode: string) => {
  await ensureDeviceCodeSchema(event)
  return getDb(event)
    .prepare(
      `SELECT dc.*, c.client_id AS public_client_id, c.name AS client_name, c.status AS client_status
       FROM device_codes dc JOIN clients c ON c.id = dc.client_id
       WHERE dc.user_code = ?`,
    )
    .bind(userCode)
    .first<DeviceCodeRow & { public_client_id: string; client_name: string; client_status?: string | null }>()
}

export const findDeviceCodeByDeviceCode = async (event: H3Event, deviceCode: string) => {
  await ensureDeviceCodeSchema(event)
  return getDb(event)
    .prepare(`SELECT * FROM device_codes WHERE device_code_hash = ?`)
    .bind(await hashToken(deviceCode))
    .first<DeviceCodeRow>()
}

export type PollOutcome = 'pending' | 'slow_down'

/**
 * Records a poll of a pending code. Polling sooner than the interval (one second of grace for
 * network jitter) is `slow_down` and permanently adds 5 seconds to this code's interval.
 */
export const recordDevicePoll = async (event: H3Event, row: DeviceCodeRow, nowMs = Date.now()): Promise<PollOutcome> => {
  const db = getDb(event)
  const interval = Number(row.poll_interval || DEVICE_POLL_INTERVAL_SECONDS)
  const last = Number(row.last_polled_ms || 0)
  if (last && nowMs - last < (interval - 1) * 1000) {
    await db.prepare(`UPDATE device_codes SET poll_interval = ?, last_polled_ms = ? WHERE id = ?`).bind(interval + 5, nowMs, row.id).run()
    return 'slow_down'
  }
  await db.prepare(`UPDATE device_codes SET last_polled_ms = ? WHERE id = ?`).bind(nowMs, row.id).run()
  return 'pending'
}

/** Compare-and-swap: of two concurrent polls after approval exactly one gets the tokens. */
export const consumeApprovedDeviceCode = async (event: H3Event, id: string) => {
  const result = await getDb(event)
    .prepare(`UPDATE device_codes SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'approved'`)
    .bind(nowInSeconds(), id)
    .run()
  return Boolean(result.meta?.changes)
}

/** Approve / deny a still-pending, unexpired code. False when someone else got there first. */
export const decideDeviceCode = async (
  event: H3Event,
  id: string,
  decision: { approve: true; globalAccountId: string; authTime: number } | { approve: false },
) => {
  const now = nowInSeconds()
  const db = getDb(event)
  const result = decision.approve
    ? await db
        .prepare(
          `UPDATE device_codes SET status = 'approved', global_account_id = ?, auth_time = ?, approved_at = ?
           WHERE id = ? AND status = 'pending' AND expires_at >= ?`,
        )
        .bind(decision.globalAccountId, decision.authTime || null, now, id, now)
        .run()
    : await db
        .prepare(`UPDATE device_codes SET status = 'denied', approved_at = ? WHERE id = ? AND status = 'pending' AND expires_at >= ?`)
        .bind(now, id, now)
        .run()
  return Boolean(result.meta?.changes)
}

/** The browser's first-party session (sso_refresh_token cookie), trusted exactly like /authorize trusts it. */
export const getDeviceApprover = getBrowserSessionAccount

/** How the approval page names the requesting app and device. */
export const describeDeviceClient = (row: { public_client_id: string; client_name: string }) => ({
  client_id: row.public_client_id,
  client_name: clientAppName(row.public_client_id) || row.client_name,
  device_name: clientDeviceName(row.public_client_id) || null,
})
