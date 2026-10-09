import { createError, H3Event } from 'h3'
import { getDb, getEnv } from './env'
import { oncePerDb } from './schema-once'
import { getIssuer } from './auth'
import { b64url, fromB64url, verifyAssertion, verifyRegistration, type StoredPublicKey } from './webauthn'

/**
 * Passkeys for a global account: sign in without a password (and without a second step —
 * a passkey is already two factors, the device plus its lock). The RP ID is the account
 * center's own host (WEBAUTHN_RP_ID, default: the issuer's hostname), so passkeys made on
 * account.leeguoo.com are not usable from other leeguoo.com sites.
 */

const CHALLENGE_TTL_SECONDS = 5 * 60
export const MAX_PASSKEYS = 10

const passkeySchema = oncePerDb(async (db) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS passkeys (
         id TEXT PRIMARY KEY,
         global_account_id TEXT NOT NULL REFERENCES global_accounts(id) ON DELETE CASCADE,
         public_key_json TEXT NOT NULL,
         sign_count INTEGER NOT NULL DEFAULT 0,
         name TEXT,
         transports TEXT,
         backed_up INTEGER,
         created_at INTEGER NOT NULL,
         last_used_at INTEGER
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_passkeys_account ON passkeys (global_account_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS webauthn_challenges (
         id TEXT PRIMARY KEY,
         challenge TEXT NOT NULL,
         purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
         global_account_id TEXT,
         expires_at INTEGER NOT NULL,
         used_at INTEGER
       )`,
    )
    .run()
})

export const ensurePasskeySchema = (event: H3Event) => passkeySchema(getDb(event))

const now = () => Math.floor(Date.now() / 1000)

export const rpIdFor = (event: H3Event) => {
  const configured = ((getEnv(event) as Record<string, string | undefined>).WEBAUTHN_RP_ID || '').trim().toLowerCase()
  if (configured) return configured
  return new URL(getIssuer(event)).hostname
}

export const createChallenge = async (event: H3Event, purpose: 'register' | 'login', globalAccountId: string | null) => {
  await ensurePasskeySchema(event)
  const db = getDb(event)
  const id = crypto.randomUUID()
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await db
    .prepare(`INSERT INTO webauthn_challenges (id, challenge, purpose, global_account_id, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, challenge, purpose, globalAccountId, now() + CHALLENGE_TTL_SECONDS)
    .run()
  // Opportunistic cleanup keeps the table small without a cron.
  if (Math.random() < 0.05) await db.prepare(`DELETE FROM webauthn_challenges WHERE expires_at < ?`).bind(now() - 3600).run()
  return { id, challenge }
}

/** Spends a challenge exactly once; refuses expired, used or mismatched ones. */
const consumeChallenge = async (event: H3Event, id: string, purpose: 'register' | 'login', globalAccountId: string | null) => {
  await ensurePasskeySchema(event)
  const db = getDb(event)
  const row = await db
    .prepare(`SELECT challenge, purpose, global_account_id, expires_at, used_at FROM webauthn_challenges WHERE id = ?`)
    .bind(id)
    .first<{ challenge: string; purpose: string; global_account_id: string | null; expires_at: number; used_at: number | null }>()
  if (!row || row.purpose !== purpose || row.used_at || row.expires_at < now() || (globalAccountId && row.global_account_id !== globalAccountId)) {
    throw createError({ statusCode: 400, statusMessage: 'passkey_challenge_expired' })
  }
  const spent = await db.prepare(`UPDATE webauthn_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(now(), id).run()
  if (!Number(spent.meta?.changes || 0)) throw createError({ statusCode: 400, statusMessage: 'passkey_challenge_expired' })
  return row.challenge
}

type CredentialInput = {
  id?: unknown
  response?: { clientDataJSON?: unknown; attestationObject?: unknown; authenticatorData?: unknown; signature?: unknown; userHandle?: unknown }
  transports?: unknown
}

const bytes = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value) throw createError({ statusCode: 400, statusMessage: `credential.${field} required (base64url)` })
  try {
    return fromB64url(value)
  } catch {
    throw createError({ statusCode: 400, statusMessage: `credential.${field} is not base64url` })
  }
}

const invalid = (error: unknown) =>
  createError({ statusCode: 400, statusMessage: `passkey_invalid: ${error instanceof Error ? error.message : String(error)}` })

export const registerPasskey = async (
  event: H3Event,
  input: { globalAccountId: string; challengeId: string; credential: CredentialInput; name?: string },
) => {
  const challenge = await consumeChallenge(event, input.challengeId, 'register', input.globalAccountId)
  const response = input.credential.response || {}
  let result
  try {
    result = await verifyRegistration({
      clientDataJSON: bytes(response.clientDataJSON, 'response.clientDataJSON'),
      attestationObject: bytes(response.attestationObject, 'response.attestationObject'),
      expectedChallenge: challenge,
      rpId: rpIdFor(event),
    })
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    throw invalid(error)
  }
  const db = getDb(event)
  const count = await db.prepare(`SELECT count(*) AS n FROM passkeys WHERE global_account_id = ?`).bind(input.globalAccountId).first<{ n: number }>()
  if (Number(count?.n || 0) >= MAX_PASSKEYS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_PASSKEYS} passkeys` })
  const transports = Array.isArray(input.credential.transports) ? input.credential.transports.filter((t) => typeof t === 'string').join(' ') : null
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO passkeys (id, global_account_id, public_key_json, sign_count, name, transports, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      result.credentialId,
      input.globalAccountId,
      JSON.stringify(result.publicKey),
      result.signCount,
      (input.name || '').trim().slice(0, 60) || null,
      transports,
      result.backedUp ? 1 : 0,
      now(),
    )
    .run()
  if (!Number(inserted.meta?.changes || 0)) throw createError({ statusCode: 409, statusMessage: 'passkey_already_registered' })
  return { id: result.credentialId }
}

/** Verifies a sign-in assertion; returns the account it belongs to. */
export const verifyPasskeyLogin = async (event: H3Event, input: { challengeId: string; credential: CredentialInput }) => {
  const challenge = await consumeChallenge(event, input.challengeId, 'login', null)
  const credentialId = typeof input.credential.id === 'string' ? input.credential.id : ''
  const db = getDb(event)
  const stored = await db
    .prepare(`SELECT id, global_account_id, public_key_json, sign_count FROM passkeys WHERE id = ?`)
    .bind(credentialId)
    .first<{ id: string; global_account_id: string; public_key_json: string; sign_count: number }>()
  if (!stored) throw createError({ statusCode: 401, statusMessage: 'passkey_unknown' })
  const response = input.credential.response || {}
  // A discoverable credential names its user: it must be the passkey's owner.
  if (typeof response.userHandle === 'string' && response.userHandle) {
    const handle = new TextDecoder().decode(bytes(response.userHandle, 'response.userHandle'))
    if (handle !== stored.global_account_id) throw createError({ statusCode: 401, statusMessage: 'passkey_unknown' })
  }
  let result
  try {
    result = await verifyAssertion({
      clientDataJSON: bytes(response.clientDataJSON, 'response.clientDataJSON'),
      authenticatorData: bytes(response.authenticatorData, 'response.authenticatorData'),
      signature: bytes(response.signature, 'response.signature'),
      expectedChallenge: challenge,
      rpId: rpIdFor(event),
      publicKey: JSON.parse(stored.public_key_json) as StoredPublicKey,
      storedSignCount: Number(stored.sign_count || 0),
    })
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    throw createError({ statusCode: 401, statusMessage: `passkey_invalid: ${error instanceof Error ? error.message : String(error)}` })
  }
  await db
    .prepare(`UPDATE passkeys SET sign_count = ?, backed_up = ?, last_used_at = ? WHERE id = ?`)
    .bind(result.signCount, result.backedUp ? 1 : 0, now(), stored.id)
    .run()
  return { globalAccountId: stored.global_account_id, credentialId: stored.id }
}

export const listPasskeys = async (event: H3Event, globalAccountId: string) => {
  await ensurePasskeySchema(event)
  return (
    (
      await getDb(event)
        .prepare(`SELECT id, name, transports, backed_up, created_at, last_used_at FROM passkeys WHERE global_account_id = ? ORDER BY created_at`)
        .bind(globalAccountId)
        .all<{ id: string; name: string | null; transports: string | null; backed_up: number | null; created_at: number; last_used_at: number | null }>()
    ).results || []
  ).map((row) => ({ ...row, backed_up: row.backed_up === 1, transports: (row.transports || '').split(' ').filter(Boolean) }))
}
