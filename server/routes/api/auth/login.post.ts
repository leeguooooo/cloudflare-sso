import { createError, defineEventHandler, readBody } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { hashAccountPassword, verifyAccountPassword } from '../../../utils/password'
import { hashPassword } from '../../../utils/crypto'
import { assertLoginAllowed, recordLoginFailure } from '../../../utils/rate-limit'
import { completePasswordSignIn } from '../../../utils/password-login'
import { isMfaEnabled, issueMfaChallenge } from '../../../utils/mfa'
import { writeAuditLog } from '../../../utils/audit'
import { resolveDefaultClientId } from '../../../utils/default-client'
import {
  ensureGlobalIdentitySchema,
  findGlobalAccountByEmail,
  getClientByPublicId,
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
  await assertLoginAllowed(event, email)
  const invalidCredentials = async () => {
    await recordLoginFailure(event, email)
    await writeAuditLog(event, { tenantId: client.tenant_id, userId: null, action: 'auth.login_failed', payload: { client_id: client.client_id } })
    return createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

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
      // Same PBKDF2 cost as a real check, so response time does not reveal which emails exist.
      await hashPassword(password, env.PASSWORD_PEPPER || '')
      throw await invalidCredentials()
    }

    const legacyPassword = await verifyAccountPassword(env, password, legacyUser.password_hash)
    if (!legacyPassword.ok) throw await invalidCredentials()

    if (legacyUser.status !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'User disabled or locked' })
    }

    const globalPasswordHash = await hashAccountPassword(env, password)
    const globalAccountId = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO global_accounts (id, email, password_hash, locale, status, password_set)
         VALUES (?, ?, ?, ?, 'active', 1)`,
      )
      .bind(globalAccountId, legacyUser.email, globalPasswordHash, legacyUser.locale || 'en')
      .run()

    await db
      .prepare(`UPDATE users SET global_account_id = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(globalAccountId, legacyUser.id)
      .run()

    globalAccount = await findGlobalAccountByEmail(event, email)
  }

  if (!globalAccount) throw await invalidCredentials()

  const passwordCheck = await verifyAccountPassword(env, password, globalAccount.password_hash)
  if (!passwordCheck.ok) throw await invalidCredentials()
  if (passwordCheck.needsRehash) {
    // Move the hash off the legacy (public) pepper now that we know the password.
    await db
      .prepare(`UPDATE global_accounts SET password_hash = ? WHERE id = ?`)
      .bind(await hashAccountPassword(env, password), globalAccount.id)
      .run()
  }

  if (globalAccount.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'Global account disabled or locked' })
  }

  // Two-step verification: no session yet. Failures are not cleared, so the per-email budget
  // also caps guesses at the second step.
  if (await isMfaEnabled(event, globalAccount.id)) {
    await writeAuditLog(event, { tenantId: client.tenant_id, userId: null, action: 'auth.mfa_challenge', payload: { client_id: client.client_id, global_account_id: globalAccount.id } })
    return {
      mfa_required: true,
      challenge: await issueMfaChallenge(event, { globalAccountId: globalAccount.id, clientId: client.client_id, email }),
      methods: ['totp', 'recovery'],
    }
  }

  return completePasswordSignIn(event, client, globalAccount, email)
})
