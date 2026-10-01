import { createError, defineEventHandler, deleteCookie, getQuery } from 'h3'
import { getDb, getEnv } from '../../../utils/env'
import { readAppleConfig, revokeAppleToken } from '../../../utils/apple'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'
import {
  buildAccountDeletionStatements,
  collectAccountUserIds,
  executeAccountDeletion,
  hasAdminRole,
  listExistingTables,
} from '../../../utils/account-deletion'

/**
 * DELETE /api/account — permanently delete the caller's own global account.
 *
 * Auth: `Authorization: Bearer <access token>` issued to any first-party client
 * (validated like every other /api/account/* route: RS256 signature, expiry,
 * token_use=access, user row exists in the token's tenant).
 *
 * Deletes the account in every tenant (see utils/account-deletion.ts). Access
 * tokens already issued stay cryptographically valid until they expire
 * (ACCESS_TOKEN_TTL_SECONDS), but every lookup of the user now fails, so
 * /userinfo and all resource servers that validate through it reject them.
 * Refresh tokens are gone, so no new access tokens can be minted.
 *
 * `?check=1` only runs the authorization + protection checks and returns
 * `{ ok: true, deletable: true }` without deleting anything, so resource
 * servers (e.g. the Pastyx API) can verify before wiping their own data.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const db = getDb(event)

  const globalAccountId = ctx.globalAccount?.id || ctx.user.global_account_id || null
  const userIds = await collectAccountUserIds(db, { userId: ctx.user.id, globalAccountId })
  const tables = await listExistingTables(db)

  if (await hasAdminRole(db, userIds, tables)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Administrator accounts cannot be deleted self-service. Contact support.',
    })
  }

  if (getQuery(event).check === '1') {
    return { ok: true, deletable: true }
  }

  // Sign in with Apple: revoke the user's Apple tokens when the account goes
  // (App Store Review Guideline 5.1.1(v)). Best effort — never blocks the deletion.
  if (globalAccountId) {
    const appleConfig = readAppleConfig(getEnv(event))
    const appleRows = appleConfig
      ? (
          await db
            .prepare(
              `SELECT refresh_token FROM global_external_identities
               WHERE global_account_id = ? AND provider = 'apple' AND refresh_token IS NOT NULL`,
            )
            .bind(globalAccountId)
            .all<{ refresh_token: string }>()
            .catch(() => ({ results: [] as { refresh_token: string }[] }))
        ).results || []
      : []
    for (const row of appleRows) {
      await revokeAppleToken(appleConfig!, row.refresh_token).catch(() => false)
    }
  }

  const statements = buildAccountDeletionStatements(userIds, globalAccountId, tables)
  await executeAccountDeletion(db, statements)

  deleteCookie(event, 'sso_refresh_token', { path: '/' })

  // No email / user id is kept: the audit row only proves a deletion happened.
  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: null,
    action: 'account.delete',
    payload: {
      client_id: ctx.principal.aud || null,
      tenant_users_deleted: userIds.length,
      had_global_account: Boolean(globalAccountId),
    },
  }).catch(() => undefined)

  return {
    ok: true,
    deleted: true,
    tenant_users_deleted: userIds.length,
  }
})
