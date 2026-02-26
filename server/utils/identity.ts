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
  locale?: string
  status: string
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
    await db.prepare(`ALTER TABLE users ADD COLUMN global_account_id TEXT`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_global_account ON users(global_account_id)`).run()
}

export const ensureClientManagementSchema = async (event: H3Event) => {
  const db = getDb(event)
  try {
    await db.prepare(`ALTER TABLE clients ADD COLUMN status TEXT DEFAULT 'active'`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }

  try {
    await db.prepare(`ALTER TABLE clients ADD COLUMN updated_at INTEGER`).run()
  } catch (error) {
    if (!hasDuplicateColumnError(error)) {
      throw error
    }
  }

  await db.prepare(`UPDATE clients SET status = 'active' WHERE status IS NULL OR status = ''`).run()
  await db
    .prepare(
      `UPDATE clients
       SET updated_at = COALESCE(updated_at, created_at, strftime('%s', 'now'))
       WHERE updated_at IS NULL`,
    )
    .run()
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
    .prepare(`SELECT id, email, password_hash, locale, status FROM global_accounts WHERE normalized_email = lower(?)`)
    .bind(email)
    .first<GlobalAccountRecord>()
}

export const createGlobalAccount = async (
  event: H3Event,
  input: {
    email: string
    passwordHash: string
    locale?: string
  },
) => {
  const db = getDb(event)
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO global_accounts (id, email, password_hash, locale, status)
       VALUES (?, ?, ?, ?, 'active')`,
    )
    .bind(id, input.email, input.passwordHash, input.locale || 'en')
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
