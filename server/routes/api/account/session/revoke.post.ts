import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireAccountUserContext } from '../../../../utils/account'
import { writeAuditLog } from '../../../../utils/audit'

type RevokeBody = {
  session_id?: string
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const body = (await readBody(event).catch(() => ({}))) as RevokeBody
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: 'session_id is required' })
  }

  const db = getDb(event)
  const target = await db
    .prepare(`SELECT id, user_id, revoked_at FROM sessions WHERE id = ?`)
    .bind(sessionId)
    .first<{ id: string; user_id: string; revoked_at?: number | null }>()
  if (!target?.id || target.user_id !== ctx.user.id) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }
  if (target.revoked_at) {
    return {
      ok: true,
      already_revoked: true,
      session_id: sessionId,
      requires_relogin: ctx.currentSessionId === sessionId,
    }
  }

  const now = Math.floor(Date.now() / 1000)
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`)
    .bind(now, sessionId)
    .run()

  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.session.revoke',
    payload: {
      session_id: sessionId,
      revoked_current_session: ctx.currentSessionId === sessionId,
    },
  })

  return {
    ok: true,
    session_id: sessionId,
    revoked_at: now,
    requires_relogin: ctx.currentSessionId === sessionId,
  }
})
