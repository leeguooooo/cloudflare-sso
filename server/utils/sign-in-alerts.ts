import { getRequestHeader, getRequestIP, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { oncePerDb } from './schema-once'
import { getIssuer } from './auth'
import { actionEmail, isEmailEnabled, sendEmail } from './email'

/**
 * "New sign-in to your account" email: sent when an account signs in from a browser / app it
 * has not used in the last 180 days (same User-Agent). The very first sign-in of an account
 * (sign-up) sends nothing. Users switch it off in the account center (account_preferences).
 * Sent after the response, so sign-in never waits on, or fails because of, email.
 */

const LOOKBACK_SECONDS = 180 * 86400

const prefsSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS account_preferences (
         global_account_id TEXT PRIMARY KEY REFERENCES global_accounts(id) ON DELETE CASCADE,
         sign_in_alerts INTEGER NOT NULL DEFAULT 1,
         updated_at INTEGER NOT NULL
       )`,
    )
    .run()
})

export const ensurePreferencesSchema = (event: H3Event) => prefsSchema(getDb(event))

export type AccountPreferences = { sign_in_alerts: boolean }

export const getPreferences = async (event: H3Event, globalAccountId: string): Promise<AccountPreferences> => {
  await ensurePreferencesSchema(event)
  const row = await getDb(event)
    .prepare(`SELECT sign_in_alerts FROM account_preferences WHERE global_account_id = ?`)
    .bind(globalAccountId)
    .first<{ sign_in_alerts: number }>()
  return { sign_in_alerts: row ? row.sign_in_alerts === 1 : true }
}

export const setPreferences = async (event: H3Event, globalAccountId: string, prefs: AccountPreferences) => {
  await ensurePreferencesSchema(event)
  await getDb(event)
    .prepare(
      `INSERT INTO account_preferences (global_account_id, sign_in_alerts, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (global_account_id) DO UPDATE SET sign_in_alerts = excluded.sign_in_alerts, updated_at = excluded.updated_at`,
    )
    .bind(globalAccountId, prefs.sign_in_alerts ? 1 : 0, Math.floor(Date.now() / 1000))
    .run()
}

/** A User-Agent without its version numbers: the same browser after an update is the same device. */
export const deviceKey = (ua: string) => ua.replace(/[\d._]+/g, '').replace(/\s+/g, ' ').trim()

/** "Chrome on macOS" style label; good enough to recognise your own device. */
export const describeDevice = (ua: string) => {
  const value = ua || ''
  const browser = /Edg\//.test(value)
    ? 'Edge'
    : /Chrome\//.test(value)
      ? 'Chrome'
      : /Firefox\//.test(value)
        ? 'Firefox'
        : /Safari\//.test(value)
          ? 'Safari'
          : /CFNetwork|Darwin/.test(value)
            ? 'App'
            : ''
  const os = /iPhone/.test(value)
    ? 'iPhone'
    : /iPad/.test(value)
      ? 'iPad'
      : /Android/.test(value)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(value)
          ? 'macOS'
          : /Windows/.test(value)
            ? 'Windows'
            : /Linux/.test(value)
              ? 'Linux'
              : ''
  if (browser && os) return `${browser} · ${os}`
  return browser || os || '未知设备 / Unknown device'
}

const sendAlert = async (event: H3Event, input: { globalAccountId: string; email: string; appName: string }) => {
  const env = getEnv(event)
  if (!isEmailEnabled(env as Record<string, string>) || !input.email || input.email.endsWith('.invalid')) return
  if (!(await getPreferences(event, input.globalAccountId)).sign_in_alerts) return

  const userAgent = getRequestHeader(event, 'user-agent') || ''
  const now = Math.floor(Date.now() / 1000)
  // Sessions opened before this request (the one just created is a few ms old). Browsers bump
  // the version in their User-Agent every few weeks, so devices are compared without numbers.
  const seen =
    (
      await getDb(event)
        .prepare(
          `SELECT DISTINCT s.user_agent AS ua, s.created_at > ? AS recent FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE u.global_account_id = ? AND s.created_at < ?`,
        )
        .bind(now - LOOKBACK_SECONDS, input.globalAccountId, now - 5)
        .all<{ ua: string | null; recent: number }>()
    ).results || []
  if (!seen.length) return
  const device = deviceKey(userAgent)
  if (seen.some((row) => row.recent && deviceKey(row.ua || '') === device)) return

  const ip = getRequestHeader(event, 'cf-connecting-ip') || getRequestIP(event) || '未知 / unknown'
  const country = getRequestHeader(event, 'cf-ipcountry') || ''
  const when = new Date(now * 1000).toISOString().replace('T', ' ').slice(0, 16)
  const label = describeDevice(userAgent)
  const security = new URL('/account?section=security', getIssuer(event)).toString()
  await sendEmail(
    event,
    actionEmail({
      to: input.email,
      subject: '新设备登录了你的 leeguoo 账号 / New sign-in to your account',
      intro: `你的账号刚刚在一台新设备上登录：${label}，IP ${ip}${country ? `（${country}）` : ''}，${when} UTC，应用：${input.appName}。如果是你本人，不用做任何事。 Your account just signed in on a new device.`,
      action: '检查账号安全 / Review security',
      url: security,
      outro: '如果不是你：立即修改密码，并在「安全性与登录」里退出其他所有设备。可以在同一页关闭这类提醒。 If this was not you, change your password and sign out other devices.',
    }),
  )
}

/** Fire-and-forget: queued after the response when the runtime allows it. Never throws. */
export const alertIfNewDevice = async (event: H3Event, input: { globalAccountId: string; email: string; appName: string }) => {
  const task = sendAlert(event, input).catch((error) => {
    console.warn('sign-in alert failed', { error: error instanceof Error ? error.message : String(error) })
  })
  const waitUntil = (event as { waitUntil?: (task: Promise<unknown>) => void }).waitUntil
  if (typeof waitUntil === 'function') waitUntil.call(event, task)
  else await task
}
