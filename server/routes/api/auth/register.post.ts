import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { hashAccountPassword } from '../../../utils/password'
import { consumeRateLimit, requestIp } from '../../../utils/rate-limit'
import { writeAuditLog } from '../../../utils/audit'
import { resolveDefaultClientId } from '../../../utils/default-client'
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
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  await consumeRateLimit(event, 'register', requestIp(event), 20, 3600)

  await ensureGlobalIdentitySchema(event)

  const clientId = body.client_id?.trim() || resolveDefaultClientId(event)
  let tenantId = body.tenant_id?.trim() || ''
  if (clientId) {
    const client = await getClientByPublicId(event, clientId)
    tenantId = client.tenant_id
  } else {
    tenantId = tenantId || 'tenant-demo'
    const tenantName = body.tenant_name || tenantId
    await ensureTenantExists(event, tenantId, tenantName)
  }

  const existingGlobal = await findGlobalAccountByEmail(event, email)
  if (existingGlobal) {
    throw createError({ statusCode: 409, statusMessage: 'Global account already exists' })
  }

  const env = getEnv(event)
  const passwordHash = await hashAccountPassword(env, password)
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
      client_id: clientId || null,
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
