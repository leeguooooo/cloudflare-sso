import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'

type ProfilePatchBody = {
  display_name?: string
  locale?: string
}

const normalizeDisplayName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return null
  if (name.length > 64) {
    throw createError({ statusCode: 400, statusMessage: 'display_name must be 64 characters or fewer' })
  }
  return name
}

const normalizeLocale = (value: unknown) => {
  const locale = typeof value === 'string' ? value.trim() : ''
  if (!locale) return null
  if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(locale)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid locale format' })
  }
  return locale
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const body = (await readBody(event).catch(() => ({}))) as ProfilePatchBody

  const nextDisplayName = normalizeDisplayName(body.display_name)
  const nextLocale = normalizeLocale(body.locale)
  if (nextDisplayName === null && nextLocale === null) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  }

  const db = getDb(event)

  if (nextLocale !== null) {
    await db
      .prepare(`UPDATE users SET locale = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(nextLocale, ctx.user.id)
      .run()
  }

  if (ctx.globalAccount?.id) {
    await db
      .prepare(
        `UPDATE global_accounts
         SET display_name = COALESCE(?, display_name),
             locale = COALESCE(?, locale),
             updated_at = strftime('%s', 'now')
         WHERE id = ?`,
      )
      .bind(nextDisplayName, nextLocale, ctx.globalAccount.id)
      .run()
  }

  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.profile.update',
    payload: {
      display_name_changed: nextDisplayName !== null,
      locale_changed: nextLocale !== null,
    },
  })

  const refreshed = await db
    .prepare(
      `SELECT
         u.email,
         u.locale,
         ga.display_name,
         ga.avatar_url
       FROM users u
       LEFT JOIN global_accounts ga ON ga.id = u.global_account_id
       WHERE u.id = ?`,
    )
    .bind(ctx.user.id)
    .first<{ email: string; locale?: string | null; display_name?: string | null; avatar_url?: string | null }>()

  return {
    profile: {
      email: refreshed?.email || ctx.user.email,
      locale: refreshed?.locale || nextLocale || ctx.user.locale || 'en',
      name: refreshed?.display_name || nextDisplayName,
      avatar_url: refreshed?.avatar_url || null,
    },
  }
})
