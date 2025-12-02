import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { hashPassword } from '../../../utils/crypto'

type RegisterBody = {
  email?: string
  password?: string
  tenant_id?: string
  tenant_name?: string
  locale?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as RegisterBody
  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const tenantId = body.tenant_id || 'tenant-demo'
  const tenantName = body.tenant_name || tenantId
  const locale = body.locale || 'en'
  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'email and password are required' })
  }

  const db = getDb(event)
  const env = getEnv(event)
  const existingTenant = await db.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenantId).first()
  if (!existingTenant) {
    await db.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).bind(tenantId, tenantName).run()
  }

  const existingUser = await db
    .prepare(`SELECT id FROM users WHERE tenant_id = ? AND normalized_email = lower(?)`)
    .bind(tenantId, email)
    .first()
  if (existingUser) {
    throw createError({ statusCode: 409, statusMessage: 'User already exists' })
  }

  const passwordHash = await hashPassword(password, env.PASSWORD_PEPPER || '')
  const userId = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, locale, status, mfa_enforced)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`,
    )
    .bind(userId, tenantId, email, passwordHash, locale)
    .run()

  await db
    .prepare(`INSERT INTO credentials (id, user_id, type, secret, meta_json) VALUES (?, ?, 'password', ?, '{}')`)
    .bind(crypto.randomUUID(), userId, passwordHash)
    .run()

  return { user_id: userId, tenant_id: tenantId, email, locale }
})
