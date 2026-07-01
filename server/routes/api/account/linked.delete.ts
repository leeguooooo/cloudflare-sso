import { createError, defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'

const ALLOWED_PROVIDERS = new Set(['google', 'github'])

export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  if (!ctx.globalAccount?.id) {
    throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  }

  const query = getQuery(event)
  const provider = typeof query.provider === 'string' ? query.provider.trim().toLowerCase() : ''
  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid provider' })
  }

  const db = getDb(event)
  const linked = await db
    .prepare(
      `SELECT id
       FROM global_external_identities
       WHERE global_account_id = ? AND provider = ?
       LIMIT 1`,
    )
    .bind(ctx.globalAccount.id, provider)
    .first<{ id: string }>()
  if (!linked?.id) {
    throw createError({ statusCode: 404, statusMessage: 'Linked provider not found' })
  }

  await db
    .prepare(`DELETE FROM global_external_identities WHERE id = ?`)
    .bind(linked.id)
    .run()

  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.linked.unlink',
    payload: {
      provider,
      global_account_id: ctx.globalAccount.id,
    },
  })

  return {
    ok: true,
    provider,
  }
})
