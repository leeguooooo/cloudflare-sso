import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'
import { readAppleConfig, revokeAppleToken } from '../../../utils/apple'
import { canRemoveIdentity, listSignInMethods, requireRecentAuth } from '../../../utils/sign-in-methods'

/**
 * DELETE /api/account/linked?id=<identity id>  (or legacy ?provider=google|github)
 * Unlinks a provider identity. Requires a sign-in within the last 15 minutes and
 * refuses to remove the account's last way to sign in. Apple tokens are revoked.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const gaid = ctx.globalAccount?.id
  if (!gaid) {
    throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  }

  const query = getQuery(event)
  const id = typeof query.id === 'string' ? query.id.trim() : ''
  const provider = typeof query.provider === 'string' ? query.provider.trim().toLowerCase() : ''
  if (!id && !provider) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }

  const db = getDb(event)
  const linked = await db
    .prepare(
      `SELECT id, provider, refresh_token FROM global_external_identities
       WHERE global_account_id = ? AND ${id ? 'id = ?' : 'provider = ?'}
       ORDER BY created_at LIMIT 1`,
    )
    .bind(gaid, id || provider)
    .first<{ id: string; provider: string; refresh_token?: string | null }>()
  if (!linked?.id) {
    throw createError({ statusCode: 404, statusMessage: 'Linked provider not found' })
  }

  await requireRecentAuth(event, ctx)

  const methods = await listSignInMethods(event, gaid)
  if (!canRemoveIdentity(methods, linked.id)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'last_method',
      data: { code: 'last_method' },
    })
  }

  await db.prepare(`DELETE FROM global_external_identities WHERE id = ?`).bind(linked.id).run()

  if (linked.provider === 'apple' && linked.refresh_token) {
    const config = readAppleConfig(getEnv(event))
    if (config) await revokeAppleToken(config, linked.refresh_token).catch(() => false)
  }

  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.linked.unlink',
    payload: { provider: linked.provider, global_account_id: gaid },
  })

  return { ok: true, provider: linked.provider, id: linked.id }
})
