import { createError, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { nowInSeconds } from './crypto'
import { oncePerDb } from './schema-once'
import { signJwt, verifyJwt } from './jwt'
import { getIssuer } from './auth'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from './totp'

/**
 * Two-step verification for a global account: one TOTP authenticator plus ten one-time
 * recovery codes. It guards password sign-in; provider sign-ins (Apple, Google, GitHub,
 * WeChat) rely on the provider's own second factor.
 */

const mfaSchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS account_mfa (
         global_account_id TEXT PRIMARY KEY REFERENCES global_accounts(id) ON DELETE CASCADE,
         key_source TEXT NOT NULL,
         totp_secret TEXT,
         pending_secret TEXT,
         pending_created_at INTEGER,
         recovery_codes_json TEXT DEFAULT '[]' NOT NULL,
         last_step INTEGER DEFAULT -1 NOT NULL,
         enabled_at INTEGER,
         updated_at INTEGER NOT NULL
       )`,
    )
    .run()
})

export const ensureMfaSchema = (event: H3Event) => mfaSchema(getDb(event))

type KeySource = 'mfa_key' | 'pepper_v2' | 'pepper'

/** The server secret the TOTP secrets are sealed with. Recorded per row so a later MFA_SECRET_KEY does not orphan old rows. */
const keyMaterial = (event: H3Event, source?: KeySource): { source: KeySource; material: string } => {
  const env = getEnv(event) as Record<string, string | undefined>
  const candidates: Array<[KeySource, string | undefined]> = [
    ['mfa_key', env.MFA_SECRET_KEY],
    ['pepper_v2', env.PASSWORD_PEPPER_V2],
    ['pepper', env.PASSWORD_PEPPER],
  ]
  for (const [name, value] of candidates) {
    if ((!source || source === name) && value) return { source: name, material: value }
  }
  throw createError({ statusCode: 500, statusMessage: 'Two-step verification is not configured' })
}

type MfaRow = {
  global_account_id: string
  key_source: KeySource
  totp_secret: string | null
  pending_secret: string | null
  pending_created_at: number | null
  recovery_codes_json: string
  last_step: number
  enabled_at: number | null
}

type RecoveryCode = { hash: string; used_at: number | null }

const PENDING_TTL_SECONDS = 15 * 60
const CHALLENGE_TTL_SECONDS = 5 * 60
export const MFA_CHALLENGE_USE = 'mfa_challenge'

const readRow = async (event: H3Event, globalAccountId: string) => {
  await ensureMfaSchema(event)
  return getDb(event).prepare(`SELECT * FROM account_mfa WHERE global_account_id = ?`).bind(globalAccountId).first<MfaRow>()
}

const parseCodes = (raw: string): RecoveryCode[] => {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export type MfaStatus = { enabled: boolean; enabled_at: number | null; recovery_codes_remaining: number }

export const getMfaStatus = async (event: H3Event, globalAccountId: string): Promise<MfaStatus> => {
  const row = await readRow(event, globalAccountId)
  if (!row?.totp_secret) return { enabled: false, enabled_at: null, recovery_codes_remaining: 0 }
  return {
    enabled: true,
    enabled_at: row.enabled_at,
    recovery_codes_remaining: parseCodes(row.recovery_codes_json).filter((c) => !c.used_at).length,
  }
}

export const isMfaEnabled = async (event: H3Event, globalAccountId: string) => Boolean((await readRow(event, globalAccountId))?.totp_secret)

/** Step one of enrolment: a fresh secret, kept pending until the user proves their app has it. */
export const startTotpEnrollment = async (event: H3Event, globalAccountId: string) => {
  const existing = await readRow(event, globalAccountId)
  if (existing?.totp_secret) throw createError({ statusCode: 409, statusMessage: 'mfa_already_enabled' })
  const { source, material } = keyMaterial(event, existing?.key_source)
  const secret = generateTotpSecret()
  const sealed = await encryptSecret(material, secret)
  const now = nowInSeconds()
  await getDb(event)
    .prepare(
      `INSERT INTO account_mfa (global_account_id, key_source, pending_secret, pending_created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (global_account_id) DO UPDATE SET pending_secret = excluded.pending_secret,
         pending_created_at = excluded.pending_created_at, updated_at = excluded.updated_at`,
    )
    .bind(globalAccountId, source, sealed, now, now)
    .run()
  return secret
}

const sealRecoveryCodes = async (event: H3Event, source: KeySource, codes: string[]) => {
  const { material } = keyMaterial(event, source)
  const hashed: RecoveryCode[] = []
  for (const code of codes) hashed.push({ hash: await hashRecoveryCode(material, code), used_at: null })
  return JSON.stringify(hashed)
}

/** Step two: the first code from the app turns it on. Returns the recovery codes, shown once. */
export const confirmTotpEnrollment = async (event: H3Event, globalAccountId: string, code: string) => {
  const row = await readRow(event, globalAccountId)
  if (row?.totp_secret) throw createError({ statusCode: 409, statusMessage: 'mfa_already_enabled' })
  if (!row?.pending_secret || !row.pending_created_at || nowInSeconds() - row.pending_created_at > PENDING_TTL_SECONDS) {
    throw createError({ statusCode: 400, statusMessage: 'mfa_setup_expired' })
  }
  const { material } = keyMaterial(event, row.key_source)
  const secret = await decryptSecret(material, row.pending_secret)
  const step = await verifyTotp(secret, code, nowInSeconds())
  if (step === null) throw createError({ statusCode: 400, statusMessage: 'invalid_code' })
  const codes = generateRecoveryCodes()
  const now = nowInSeconds()
  await getDb(event)
    .prepare(
      `UPDATE account_mfa SET totp_secret = pending_secret, pending_secret = NULL, pending_created_at = NULL,
         recovery_codes_json = ?, last_step = ?, enabled_at = ?, updated_at = ?
       WHERE global_account_id = ? AND totp_secret IS NULL`,
    )
    .bind(await sealRecoveryCodes(event, row.key_source, codes), step, now, now, globalAccountId)
    .run()
  return codes
}

export const regenerateRecoveryCodes = async (event: H3Event, globalAccountId: string) => {
  const row = await readRow(event, globalAccountId)
  if (!row?.totp_secret) throw createError({ statusCode: 400, statusMessage: 'mfa_not_enabled' })
  const codes = generateRecoveryCodes()
  await getDb(event)
    .prepare(`UPDATE account_mfa SET recovery_codes_json = ?, updated_at = ? WHERE global_account_id = ?`)
    .bind(await sealRecoveryCodes(event, row.key_source, codes), nowInSeconds(), globalAccountId)
    .run()
  return codes
}

export const disableMfa = async (event: H3Event, globalAccountId: string) => {
  await ensureMfaSchema(event)
  const result = await getDb(event).prepare(`DELETE FROM account_mfa WHERE global_account_id = ?`).bind(globalAccountId).run()
  return Number(result.meta?.changes || 0) > 0
}

/**
 * Checks a second factor: a 6-digit authenticator code (each step accepted once) or an unused
 * recovery code (then marked used). Both updates are compare-and-swap, so two concurrent
 * requests cannot spend the same code.
 */
export const verifySecondFactor = async (event: H3Event, globalAccountId: string, input: string): Promise<'totp' | 'recovery' | null> => {
  const row = await readRow(event, globalAccountId)
  if (!row?.totp_secret) return null
  const { material } = keyMaterial(event, row.key_source)
  const db = getDb(event)
  const code = input.trim()

  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    const secret = await decryptSecret(material, row.totp_secret)
    const step = await verifyTotp(secret, code, nowInSeconds(), row.last_step)
    if (step === null) return null
    const swapped = await db
      .prepare(`UPDATE account_mfa SET last_step = ?, updated_at = ? WHERE global_account_id = ? AND last_step < ?`)
      .bind(step, nowInSeconds(), globalAccountId, step)
      .run()
    return Number(swapped.meta?.changes || 0) > 0 ? 'totp' : null
  }

  if (normalizeRecoveryCode(code).length !== 8) return null
  const hash = await hashRecoveryCode(material, code)
  const codes = parseCodes(row.recovery_codes_json)
  const match = codes.find((c) => c.hash === hash && !c.used_at)
  if (!match) return null
  match.used_at = nowInSeconds()
  const swapped = await db
    .prepare(`UPDATE account_mfa SET recovery_codes_json = ?, updated_at = ? WHERE global_account_id = ? AND recovery_codes_json = ?`)
    .bind(JSON.stringify(codes), nowInSeconds(), globalAccountId, row.recovery_codes_json)
    .run()
  return Number(swapped.meta?.changes || 0) > 0 ? 'recovery' : null
}

/** Short-lived proof that the password was right; only /api/auth/mfa/verify accepts it. */
export const issueMfaChallenge = (event: H3Event, input: { globalAccountId: string; clientId: string; email: string }) =>
  signJwt(
    event,
    { token_use: MFA_CHALLENGE_USE, sub: input.globalAccountId, client_id: input.clientId, email: input.email },
    { expiresInSeconds: CHALLENGE_TTL_SECONDS, issuer: getIssuer(event) },
  )

export const readMfaChallenge = async (event: H3Event, challenge: string) => {
  let payload: Record<string, unknown>
  try {
    payload = (await verifyJwt(event, challenge)) as Record<string, unknown>
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'mfa_challenge_expired' })
  }
  if (payload.token_use !== MFA_CHALLENGE_USE || typeof payload.sub !== 'string' || typeof payload.client_id !== 'string') {
    throw createError({ statusCode: 401, statusMessage: 'mfa_challenge_expired' })
  }
  return { globalAccountId: payload.sub, clientId: payload.client_id, email: String(payload.email || '') }
}
