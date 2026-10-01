import { createError, H3Event } from 'h3'
import { getDb } from './env'

export type ClientRecord = {
  id: string
  client_id: string
  tenant_id: string
  scope: string
  status?: string | null
}

export type GlobalAccountRecord = {
  id: string
  email: string
  password_hash: string
  display_name?: string | null
  avatar_url?: string | null
  locale?: string
  status: string
  password_set?: number | null
}

export type GlobalExternalIdentityRecord = {
  id: string
  global_account_id: string
  provider: string
  subject: string
  email?: string | null
  profile_json?: string | null
}

export type TenantUserRecord = {
  id: string
  tenant_id: string
  email: string
  locale?: string
  status: string
  global_account_id?: string | null
}

const hasDuplicateColumnError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  return message.toLowerCase().includes('duplicate column name')
}

const readTableColumns = async (db: D1Database, tableName: 'clients') => {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>()
  return new Set((result.results || []).map((column) => column.name).filter(Boolean))
}

const addColumnIfMissing = async (
  db: D1Database,
  columns: Set<string>,
  tableName: 'clients',
  columnName: string,
  definition: string,
) => {
  if (columns.has(columnName)) return

  try {
    await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`).run()
    columns.add(columnName)
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
    columns.add(columnName)
  }
}

export const ensureGlobalIdentitySchema = async (event: H3Event) => {
  const db = getDb(event)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS global_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        normalized_email TEXT GENERATED ALWAYS AS (lower(email)) VIRTUAL,
        password_hash TEXT NOT NULL,
        locale TEXT DEFAULT 'en',
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
        created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
      )`,
    )
    .run()
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_global_accounts_email_unique ON global_accounts(normalized_email)`).run()

  try {
    await db.prepare(`ALTER TABLE global_accounts ADD COLUMN display_name TEXT`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }

  try {
    await db.prepare(`ALTER TABLE global_accounts ADD COLUMN avatar_url TEXT`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }

  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN global_account_id TEXT`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_global_account ON users(global_account_id)`).run()

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS global_external_identities (
        id TEXT PRIMARY KEY,
        global_account_id TEXT NOT NULL REFERENCES global_accounts(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        profile_json TEXT DEFAULT '{}' NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
      )`,
    )
    .run()
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_global_external_identities_unique ON global_external_identities(provider, subject)`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_global_external_identities_account ON global_external_identities(global_account_id)`).run()
  await ensureLinkingSchema(db)
}

const addColumn = async (db: D1Database, table: string, definition: string) => {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) throw error
  }
}

let linkingSchemaReady: Promise<void> | null = null

/**
 * Sign-in methods / account linking (2026-10). Additive and idempotent:
 * - global_accounts.password_set: whether the account has a password the user chose.
 *   Accounts created by a social sign-in got a random, unknowable password. Backfill:
 *   an account whose first linked identity was created within 30 s of the account
 *   itself was created by that sign-in (password_set = 0); every other account = 1.
 * - global_external_identities: Apple-specific flags and the provider refresh token
 *   (Apple requires revoking it when the account is deleted).
 * - oauth_states: server-side OAuth state (the cookie only carries the random state).
 * - account_merges: merge proposals and their progress (retryable, idempotent).
 * Run once per isolate.
 */
export const ensureLinkingSchema = (db: D1Database): Promise<void> => {
  if (!linkingSchemaReady) {
    linkingSchemaReady = (async () => {
      await addColumn(db, 'global_accounts', 'password_set INTEGER')
      await db
        .prepare(
          `UPDATE global_accounts
           SET password_set = CASE WHEN EXISTS (
             SELECT 1 FROM global_external_identities gei
             WHERE gei.global_account_id = global_accounts.id
               AND gei.created_at - global_accounts.created_at BETWEEN -5 AND 30
           ) THEN 0 ELSE 1 END
           WHERE password_set IS NULL`,
        )
        .run()
      await addColumn(db, 'global_external_identities', 'email_verified INTEGER')
      await addColumn(db, 'global_external_identities', 'is_private_email INTEGER')
      await addColumn(db, 'global_external_identities', 'email_disabled INTEGER')
      await addColumn(db, 'global_external_identities', 'refresh_token TEXT')
      await addColumn(db, 'global_external_identities', 'consent_revoked_at INTEGER')
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS oauth_states (
            state TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
          )`,
        )
        .run()
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS account_merges (
            id TEXT PRIMARY KEY,
            from_global_account_id TEXT NOT NULL,
            to_global_account_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            subject TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'proposed',
            error TEXT,
            detail_json TEXT DEFAULT '{}' NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
          )`,
        )
        .run()
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_account_merges_to ON account_merges(to_global_account_id, status)`).run()
    })().catch((error) => {
      linkingSchemaReady = null
      throw error
    })
  }
  return linkingSchemaReady
}

/** Test hook: forget that the schema was ensured in this isolate. */
export const resetLinkingSchemaMemo = () => {
  linkingSchemaReady = null
}

export const ensureClientManagementSchema = async (event: H3Event) => {
  const db = getDb(event)
  const columns = await readTableColumns(db, 'clients')

  await addColumnIfMissing(db, columns, 'clients', 'status', `status TEXT DEFAULT 'active'`)
  await addColumnIfMissing(db, columns, 'clients', 'updated_at', `updated_at INTEGER`)

  await db.prepare(`UPDATE clients SET status = 'active' WHERE status IS NULL OR status = ''`).run()
  const updatedAtFallback = columns.has('created_at')
    ? `COALESCE(updated_at, created_at, strftime('%s', 'now'))`
    : `COALESCE(updated_at, strftime('%s', 'now'))`
  await db.prepare(`UPDATE clients SET updated_at = ${updatedAtFallback} WHERE updated_at IS NULL`).run()
}

export const getClientByPublicId = async (event: H3Event, clientPublicId: string) => {
  await ensureClientManagementSchema(event)
  const db = getDb(event)
  const client = await db
    .prepare(`SELECT id, client_id, tenant_id, scope, status FROM clients WHERE client_id = ?`)
    .bind(clientPublicId)
    .first<ClientRecord>()
  if (!client) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown client_id' })
  }
  if ((client.status || 'active') !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Client disabled' })
  }
  return client
}

export const ensureTenantExists = async (event: H3Event, tenantId: string, tenantName?: string) => {
  const db = getDb(event)
  const existing = await db.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenantId).first<{ id: string }>()
  if (existing) return
  await db.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).bind(tenantId, tenantName || tenantId).run()
}

export const findGlobalAccountByEmail = async (event: H3Event, email: string) => {
  const db = getDb(event)
  return db
    .prepare(
      `SELECT id, email, password_hash, display_name, avatar_url, locale, status, password_set
       FROM global_accounts
       WHERE normalized_email = lower(?)`,
    )
    .bind(email)
    .first<GlobalAccountRecord>()
}

export const findGlobalAccountById = async (event: H3Event, id: string) => {
  const db = getDb(event)
  return db
    .prepare(
      `SELECT id, email, password_hash, display_name, avatar_url, locale, status, password_set
       FROM global_accounts
       WHERE id = ?`,
    )
    .bind(id)
    .first<GlobalAccountRecord>()
}

export const findGlobalAccountByExternalIdentity = async (
  event: H3Event,
  provider: string,
  subject: string,
) => {
  const db = getDb(event)
  return db
    .prepare(
      `SELECT ga.id, ga.email, ga.password_hash, ga.display_name, ga.avatar_url, ga.locale, ga.status, ga.password_set
       FROM global_external_identities gei
       JOIN global_accounts ga ON ga.id = gei.global_account_id
       WHERE gei.provider = ? AND gei.subject = ?`,
    )
    .bind(provider, subject)
    .first<GlobalAccountRecord>()
}

export const linkExternalIdentityToGlobalAccount = async (
  event: H3Event,
  input: {
    globalAccountId: string
    provider: string
    subject: string
    email?: string | null
    profile?: Record<string, unknown>
  },
) => {
  const db = getDb(event)
  const existing = await db
    .prepare(`SELECT id, global_account_id FROM global_external_identities WHERE provider = ? AND subject = ?`)
    .bind(input.provider, input.subject)
    .first<{ id: string; global_account_id: string }>()

  if (existing?.id) {
    if (existing.global_account_id !== input.globalAccountId) {
      throw createError({ statusCode: 409, statusMessage: 'External identity already linked to another account' })
    }

    await db
      .prepare(
        `UPDATE global_external_identities
         SET email = ?, profile_json = ?, updated_at = strftime('%s', 'now')
         WHERE id = ?`,
      )
      .bind(input.email || null, JSON.stringify(input.profile || {}), existing.id)
      .run()
    return existing.id
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO global_external_identities (id, global_account_id, provider, subject, email, profile_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.globalAccountId, input.provider, input.subject, input.email || null, JSON.stringify(input.profile || {}))
    .run()
  return id
}

export const createGlobalAccount = async (
  event: H3Event,
  input: {
    email: string
    passwordHash: string
    locale?: string
    /** false when the password is a random placeholder (social sign-up). Default true. */
    passwordSet?: boolean
    displayName?: string | null
  },
) => {
  const db = getDb(event)
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO global_accounts (id, email, password_hash, locale, status, password_set, display_name)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(id, input.email, input.passwordHash, input.locale || 'en', input.passwordSet === false ? 0 : 1, input.displayName || null)
    .run()
  return id
}

const ensureRoleByName = async (event: H3Event, tenantId: string, name: string, description: string) => {
  const db = getDb(event)
  const existing = await db
    .prepare(`SELECT id FROM roles WHERE tenant_id = ? AND name = ?`)
    .bind(tenantId, name)
    .first<{ id: string }>()
  if (existing?.id) return existing.id
  const roleId = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO roles (id, tenant_id, name, description, built_in) VALUES (?, ?, ?, ?, 1)`)
    .bind(roleId, tenantId, name, description)
    .run()
  return roleId
}

const ensureUserRole = async (event: H3Event, tenantId: string, userId: string) => {
  const db = getDb(event)
  const roleId = await ensureRoleByName(event, tenantId, 'user', 'Default user role')
  await db
    .prepare(`INSERT OR IGNORE INTO user_roles (id, user_id, role_id, client_id) VALUES (?, ?, ?, NULL)`)
    .bind(crypto.randomUUID(), userId, roleId)
    .run()
}

export const findTenantUserByEmail = async (event: H3Event, tenantId: string, email: string) => {
  const db = getDb(event)
  return db
    .prepare(`SELECT id, tenant_id, email, locale, status, global_account_id FROM users WHERE tenant_id = ? AND normalized_email = lower(?)`)
    .bind(tenantId, email)
    .first<TenantUserRecord>()
}

export const findTenantUserByGlobalAccount = async (event: H3Event, tenantId: string, globalAccountId: string) => {
  const db = getDb(event)
  return db
    .prepare(`SELECT id, tenant_id, email, locale, status, global_account_id FROM users WHERE tenant_id = ? AND global_account_id = ?`)
    .bind(tenantId, globalAccountId)
    .first<TenantUserRecord>()
}

export const provisionTenantUserForGlobalAccount = async (
  event: H3Event,
  input: {
    tenantId: string
    globalAccountId: string
    email: string
    locale?: string
    tenantPasswordHash?: string | null
  },
) => {
  const db = getDb(event)
  const existingByGlobal = await findTenantUserByGlobalAccount(event, input.tenantId, input.globalAccountId)
  if (existingByGlobal) {
    await ensureUserRole(event, input.tenantId, existingByGlobal.id)
    return { user: existingByGlobal, created: false }
  }

  const existingByEmail = await findTenantUserByEmail(event, input.tenantId, input.email)
  if (existingByEmail) {
    if (existingByEmail.global_account_id && existingByEmail.global_account_id !== input.globalAccountId) {
      throw createError({ statusCode: 409, statusMessage: 'Email already bound to another global account in tenant' })
    }
    await db
      .prepare(`UPDATE users SET global_account_id = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(input.globalAccountId, existingByEmail.id)
      .run()
    await ensureUserRole(event, input.tenantId, existingByEmail.id)
    return {
      user: {
        ...existingByEmail,
        global_account_id: input.globalAccountId,
      },
      created: false,
    }
  }

  const userId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, locale, status, mfa_enforced, global_account_id)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`,
    )
    .bind(userId, input.tenantId, input.email, input.tenantPasswordHash || null, input.locale || 'en', input.globalAccountId)
    .run()

  await ensureUserRole(event, input.tenantId, userId)

  return {
    user: {
      id: userId,
      tenant_id: input.tenantId,
      email: input.email,
      locale: input.locale || 'en',
      status: 'active',
      global_account_id: input.globalAccountId,
    } satisfies TenantUserRecord,
    created: true,
  }
}

export const findUserById = async (event: H3Event, userId: string) => {
  const db = getDb(event)
  return db
    .prepare(`SELECT id, tenant_id, email, locale, status, global_account_id FROM users WHERE id = ?`)
    .bind(userId)
    .first<TenantUserRecord>()
}
