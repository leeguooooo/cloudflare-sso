/**
 * Effects of Apple's server-to-server notifications.
 *
 * - email-disabled / email-enabled: the user turned private-relay forwarding off/on.
 *   Recorded on the identity (email_disabled) so nothing relies on that address.
 * - consent-revoked: the user stopped using Sign in with Apple with our apps. Apple
 *   asks to treat it as a sign-out: every session of the account is revoked and the
 *   stored Apple refresh token dropped. The link itself stays, so signing in with
 *   Apple again returns to the same account.
 * - account-delete: the Apple ID is gone for good. The Apple identity is removed and
 *   sessions revoked. If Apple was the account's ONLY way to sign in, the account can
 *   never be reached again, so it is deleted together with connected apps' data.
 */
import { H3Event } from 'h3'
import { callAccountHooks } from './account-hooks'
import {
  buildAccountDeletionStatements,
  collectAccountUserIds,
  executeAccountDeletion,
  hasAdminRole,
  listExistingTables,
} from './account-deletion'
import type { AppleNotificationEvent } from './apple'
import { writeAuditLog } from './audit'
import { getDb } from './env'
import { ensureGlobalIdentitySchema } from './identity'
import { canRemoveIdentity, listSignInMethods } from './sign-in-methods'

const revokeAllSessions = (db: D1Database, gaid: string) =>
  db
    .prepare(
      `UPDATE sessions SET revoked_at = strftime('%s', 'now')
       WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE global_account_id = ?)`,
    )
    .bind(gaid)
    .run()

/** Deletes a global account everywhere (issuer + connected apps). Admin accounts are kept. */
export const deleteAccountEverywhere = async (event: H3Event, gaid: string) => {
  const db = getDb(event)
  const tables = await listExistingTables(db)
  const anyUser = await db.prepare(`SELECT id FROM users WHERE global_account_id = ? LIMIT 1`).bind(gaid).first<{ id: string }>()
  const userIds = anyUser ? await collectAccountUserIds(db, { userId: anyUser.id, globalAccountId: gaid }) : []
  if (await hasAdminRole(db, userIds, tables)) return { deleted: false, reason: 'admin' as const }
  const hooks = await callAccountHooks(event, 'delete', { userId: gaid })
  if (hooks.some((hook) => !hook.ok)) return { deleted: false, reason: 'hook_failed' as const, hooks }
  await executeAccountDeletion(db, buildAccountDeletionStatements(userIds, gaid, tables))
  return { deleted: true as const, hooks }
}

export const handleAppleAccountEvent = async (
  event: H3Event,
  notification: AppleNotificationEvent,
  revoke: (refreshToken: string) => Promise<unknown>,
) => {
  await ensureGlobalIdentitySchema(event)
  const db = getDb(event)
  const identity = await db
    .prepare(`SELECT id, global_account_id, refresh_token FROM global_external_identities WHERE provider = 'apple' AND subject = ?`)
    .bind(notification.sub)
    .first<{ id: string; global_account_id: string; refresh_token?: string | null }>()
  if (!identity) return { handled: false, type: notification.type }

  const audit = (action: string, payload: Record<string, unknown> = {}) =>
    writeAuditLog(event, {
      tenantId: null,
      userId: null,
      action,
      payload: { provider: 'apple', global_account_id: identity.global_account_id, ...payload },
    }).catch(() => undefined)

  switch (notification.type) {
    case 'email-disabled':
    case 'email-enabled': {
      await db
        .prepare(`UPDATE global_external_identities SET email_disabled = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
        .bind(notification.type === 'email-disabled' ? 1 : 0, identity.id)
        .run()
      await audit(`account.apple.${notification.type}`)
      return { handled: true, type: notification.type }
    }
    case 'consent-revoked': {
      await db
        .prepare(
          `UPDATE global_external_identities
           SET consent_revoked_at = strftime('%s', 'now'), refresh_token = NULL, updated_at = strftime('%s', 'now')
           WHERE id = ?`,
        )
        .bind(identity.id)
        .run()
      await revokeAllSessions(db, identity.global_account_id)
      await audit('account.apple.consent_revoked')
      return { handled: true, type: notification.type }
    }
    case 'account-delete': {
      const methods = await listSignInMethods(event, identity.global_account_id)
      if (identity.refresh_token) await Promise.resolve(revoke(identity.refresh_token)).catch(() => undefined)
      if (canRemoveIdentity(methods, identity.id)) {
        await db.prepare(`DELETE FROM global_external_identities WHERE id = ?`).bind(identity.id).run()
        await revokeAllSessions(db, identity.global_account_id)
        await audit('account.apple.account_deleted', { account_kept: true })
        return { handled: true, type: notification.type, accountDeleted: false }
      }
      const result = await deleteAccountEverywhere(event, identity.global_account_id)
      if (!result.deleted) {
        await db.prepare(`DELETE FROM global_external_identities WHERE id = ?`).bind(identity.id).run()
        await revokeAllSessions(db, identity.global_account_id)
      }
      await audit('account.apple.account_deleted', { account_kept: !result.deleted, reason: result.deleted ? null : result.reason })
      return { handled: true, type: notification.type, accountDeleted: result.deleted }
    }
    default:
      return { handled: false, type: notification.type }
  }
}
