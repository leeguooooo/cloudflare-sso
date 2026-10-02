import { H3Event } from 'h3'
import { getDb } from './env'
import { hashToken, nowInSeconds, randomId } from './crypto'
import { oncePerDb } from './schema-once'

export type EmailTokenPurpose = 'reset_password' | 'verify_email' | 'change_email'

export const EMAIL_TOKEN_TTL: Record<EmailTokenPurpose, number> = {
  reset_password: 30 * 60,
  verify_email: 24 * 60 * 60,
  change_email: 60 * 60,
}

const isDuplicateColumn = (error: unknown) => /duplicate column/i.test(String((error as Error)?.message || error))

const accountEmailSchema = oncePerDb(async (db) => {
  try {
    await db.prepare(`ALTER TABLE global_accounts ADD COLUMN email_verified_at INTEGER`).run()
  } catch (error) {
    if (!isDuplicateColumn(error)) throw error
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS account_email_tokens (
         id TEXT PRIMARY KEY,
         global_account_id TEXT NOT NULL REFERENCES global_accounts(id) ON DELETE CASCADE,
         purpose TEXT NOT NULL,
         token_hash TEXT NOT NULL UNIQUE,
         new_email TEXT,
         expires_at INTEGER NOT NULL,
         consumed_at INTEGER,
         created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
       )`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_account_email_tokens_account ON account_email_tokens (global_account_id, purpose)`).run()
})

export const ensureAccountEmailSchema = (event: H3Event) => accountEmailSchema(getDb(event))

/** Issues a single-use token; earlier unused tokens of the same purpose stop working. */
export const issueEmailToken = async (event: H3Event, globalAccountId: string, purpose: EmailTokenPurpose, newEmail?: string) => {
  await ensureAccountEmailSchema(event)
  const db = getDb(event)
  const raw = randomId(32)
  const now = nowInSeconds()
  await db.batch([
    db
      .prepare(`UPDATE account_email_tokens SET consumed_at = ? WHERE global_account_id = ? AND purpose = ? AND consumed_at IS NULL`)
      .bind(now, globalAccountId, purpose),
    db
      .prepare(
        `INSERT INTO account_email_tokens (id, global_account_id, purpose, token_hash, new_email, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), globalAccountId, purpose, await hashToken(raw), newEmail || null, now + EMAIL_TOKEN_TTL[purpose]),
  ])
  return raw
}

/** Consumes a live token of one of `purposes` (compare-and-swap, so it works exactly once). */
export const consumeEmailToken = async (event: H3Event, raw: string, purposes: EmailTokenPurpose[]) => {
  await ensureAccountEmailSchema(event)
  if (!raw) return null
  const db = getDb(event)
  const row = await db
    .prepare(`SELECT id, global_account_id, purpose, new_email, expires_at, consumed_at FROM account_email_tokens WHERE token_hash = ?`)
    .bind(await hashToken(raw))
    .first<{ id: string; global_account_id: string; purpose: EmailTokenPurpose; new_email: string | null; expires_at: number; consumed_at: number | null }>()
  if (!row || row.consumed_at || row.expires_at < nowInSeconds() || !purposes.includes(row.purpose)) return null
  const claimed = await db
    .prepare(`UPDATE account_email_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .bind(nowInSeconds(), row.id)
    .run()
  if (!claimed.meta?.changes) return null
  return row
}

export const markEmailVerified = async (event: H3Event, globalAccountId: string) => {
  await ensureAccountEmailSchema(event)
  await getDb(event)
    .prepare(`UPDATE global_accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = strftime('%s', 'now') WHERE id = ?`)
    .bind(nowInSeconds(), globalAccountId)
    .run()
}
