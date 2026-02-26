import { defineEventHandler, deleteCookie, getCookie, readBody } from 'h3'
import { revokeSession, getSessionByRefreshToken } from '../../../utils/auth'
import { writeAuditLog } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as { refresh_token?: string }
  const refreshToken = body.refresh_token || getCookie(event, 'sso_refresh_token')
  if (refreshToken) {
    const session = await getSessionByRefreshToken(event, refreshToken)
    if (session) {
      await revokeSession(event, session.id)
      await writeAuditLog(event, {
        tenantId: session.tenant_id,
        userId: session.user_id,
        action: 'auth.logout',
        payload: { session_id: session.id },
      })
    }
  }
  deleteCookie(event, 'sso_refresh_token', { path: '/' })
  return { success: true }
})
