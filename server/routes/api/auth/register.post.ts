import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { hashPassword } from '../../../utils/crypto'
import { writeAuditLog } from '../../../utils/audit'
import {
  createGlobalAccount,
  ensureGlobalIdentitySchema,
  ensureTenantExists,
  findGlobalAccountByEmail,
  getClientByPublicId,
  provisionTenantUserForGlobalAccount,
} from '../../../utils/identity'

type RegisterBody = {
  email?: string
  password?: string
  tenant_id?: string
  tenant_name?: string
  client_id?: string
  locale?: string
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as RegisterBody
  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const locale = body.locale || 'en'

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'email and password are required' })
  }

  await ensureGlobalIdentitySchema(event)

  let tenantId = body.tenant_id || 'tenant-demo'
  if (body.client_id) {
    const client = await getClientByPublicId(event, body.client_id)
    tenantId = client.tenant_id
  } else {
    const tenantName = body.tenant_name || tenantId
    await ensureTenantExists(event, tenantId, tenantName)
  }

  const existingGlobal = await findGlobalAccountByEmail(event, email)
  if (existingGlobal) {
    throw createError({ statusCode: 409, statusMessage: 'Global account already exists' })
  }

  const env = getEnv(event)
  const passwordHash = await hashPassword(password, env.PASSWORD_PEPPER || '')
  const globalAccountId = await createGlobalAccount(event, {
    email,
    passwordHash,
    locale,
  })

  const provisioned = await provisionTenantUserForGlobalAccount(event, {
    tenantId,
    globalAccountId,
    email,
    locale,
    tenantPasswordHash: passwordHash,
  })

  const db = getDb(event)
  const credential = await db
    .prepare(`SELECT id FROM credentials WHERE user_id = ? AND type = 'password' LIMIT 1`)
    .bind(provisioned.user.id)
    .first<{ id: string }>()
  if (!credential?.id) {
    await db
      .prepare(`INSERT INTO credentials (id, user_id, type, secret, meta_json) VALUES (?, ?, 'password', ?, '{}')`)
      .bind(crypto.randomUUID(), provisioned.user.id, passwordHash)
      .run()
  }

  await writeAuditLog(event, {
    tenantId,
    userId: provisioned.user.id,
    action: 'auth.register',
    payload: {
      email,
      global_account_id: globalAccountId,
      created_tenant_user: provisioned.created,
      client_id: body.client_id || null,
    },
  })

  return {
    user_id: provisioned.user.id,
    tenant_id: tenantId,
    email,
    locale,
    global_account_id: globalAccountId,
    created: provisioned.created,
  }
})
