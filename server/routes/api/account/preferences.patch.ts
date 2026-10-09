import { createError, defineEventHandler, readBody } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { writeAuditLog } from '../../../utils/audit'
import { getPreferences, setPreferences } from '../../../utils/sign-in-alerts'

/** PATCH /api/account/preferences { sign_in_alerts: boolean } */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const gaid = ctx.globalAccount?.id
  if (!gaid) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { sign_in_alerts?: unknown }
  if (typeof body.sign_in_alerts !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'sign_in_alerts must be a boolean' })
  await setPreferences(event, gaid, { sign_in_alerts: body.sign_in_alerts })
  await writeAuditLog(event, { tenantId: ctx.user.tenant_id, userId: ctx.user.id, action: 'account.preferences.update', payload: { sign_in_alerts: body.sign_in_alerts } })
  return getPreferences(event, gaid)
})
