import { createError, defineEventHandler, readBody, setCookie } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { hashPassword, verifyPassword } from '../../../utils/crypto'
import { issueTokens } from '../../../utils/auth'
import { getUserRolesForClient } from '../../../utils/access'
import { writeAuditLog } from '../../../utils/audit'
import { resolveDefaultClientId } from '../../../utils/default-client'
import {
  ensureGlobalIdentitySchema,
  findGlobalAccountByEmail,
  getClientByPublicId,
  provisionTenantUserForGlobalAccount,
} from '../../../utils/identity'

type LoginBody = {
  email?: string
  password?: string
  tenant_id?: string
  client_id?: string
}

type LegacyUserRow = {
  id: string
  tenant_id: string
  email: string
  password_hash: string | null
  locale?: string
  status: string
  global_account_id?: string | null
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as LoginBody
  const email = body.email?.toLowerCase().trim()
  const password = body.password
  const clientPublicId = body.client_id?.trim() || resolveDefaultClientId(event)

  if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'email and password required' })

  await ensureGlobalIdentitySchema(event)

  const client = await getClientByPublicId(event, clientPublicId)
  if (body.tenant_id && body.tenant_id !== client.tenant_id) {
    throw createError({ statusCode: 403, statusMessage: 'tenant_id and client_id mismatch' })
  }

  const db = getDb(event)
  const env = getEnv(event)

  let globalAccount = await findGlobalAccountByEmail(event, email)

  // Compatibility path: migrate existing tenant-local password users into global account model.
  if (!globalAccount) {
    const legacyUser = await db
      .prepare(
        `SELECT id, tenant_id, email, password_hash, locale, status, global_account_id
         FROM users
         WHERE tenant_id = ? AND normalized_email = lower(?)`,
      )
      .bind(client.tenant_id, email)
      .first<LegacyUserRow>()

    if (!legacyUser || !legacyUser.password_hash) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
    }

    const legacyPasswordOk = await verifyPassword(password, legacyUser.password_hash, env.PASSWORD_PEPPER || '')
    if (!legacyPasswordOk) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
    }

    if (legacyUser.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })
    }

    const globalPasswordHash = await hashPassword(password, env.PASSWORD_PEPPER || '')
    const globalAccountId = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO global_accounts (id, email, password_hash, locale, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .bind(globalAccountId, legacyUser.email, globalPasswordHash, legacyUser.locale || 'en')
      .run()

    await db
      .prepare(`UPDATE users SET global_account_id = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(globalAccountId, legacyUser.id)
      .run()

    globalAccount = await findGlobalAccountByEmail(event, email)
  }

  if (!globalAccount) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  if (globalAccount.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
  }

  const passwordOk = await verifyPassword(password, globalAccount.password_hash, env.PASSWORD_PEPPER || '')
  if (!passwordOk) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  const provisioned = await provisionTenantUserForGlobalAccount(event, {
    tenantId: client.tenant_id,
    globalAccountId: globalAccount.id,
    email: globalAccount.email,
    locale: globalAccount.locale || 'en',
  })

  if (provisioned.user.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })
  }

  const roles = await getUserRolesForClient(event, provisioned.user.id, provisioned.user.tenant_id, client.id)
  const tokens = await issueTokens(event, provisioned.user, client, client.scope || 'openid profile email', undefined, roles)

  setCookie(event, 'sso_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(tokens.refreshTokenExpiresAt * 1000),
  })

  await writeAuditLog(event, {
    tenantId: provisioned.user.tenant_id,
    userId: provisioned.user.id,
    action: 'auth.login',
    payload: {
      client_id: client.client_id,
      global_account_id: provisioned.user.global_account_id || null,
      provisioned_created: provisioned.created,
    },
  })

  return {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.accessTokenExpiresIn,
    scope: client.scope,
    user: {
      id: provisioned.user.id,
      email: provisioned.user.email,
      tenant_id: provisioned.user.tenant_id,
      locale: provisioned.user.locale,
      global_account_id: provisioned.user.global_account_id,
    },
  }
})
