import { createError, defineEventHandler, readBody } from 'h3'
import { requireAppleConfig, revokeAppleToken, verifyAppleNotification } from '../../../../utils/apple'
import { handleAppleAccountEvent } from '../../../../utils/apple-events'

/**
 * POST /api/auth/apple/notifications — Sign in with Apple server-to-server
 * notifications (configured on the primary App ID). Body: {"payload": "<JWT>"}.
 */
export default defineEventHandler(async (event) => {
  const config = requireAppleConfig(event)
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { payload?: unknown }
  if (typeof body.payload !== 'string' || !body.payload) {
    throw createError({ statusCode: 400, statusMessage: 'payload required' })
  }
  const notification = await verifyAppleNotification(config, body.payload)
  const outcome = await handleAppleAccountEvent(event, notification, (token) => revokeAppleToken(config, token))
  return { ok: true, ...outcome }
})
