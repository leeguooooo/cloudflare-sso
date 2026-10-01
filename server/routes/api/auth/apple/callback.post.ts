import { defineEventHandler, readBody, sendRedirect } from 'h3'
import { randomId } from '../../../../utils/crypto'
import { putTransient } from '../../../../utils/oauth-state'

/**
 * POST /api/auth/apple/callback — Apple's response_mode=form_post lands here as a
 * cross-site POST, which does not carry our SameSite=Lax cookies. Park the posted
 * fields server side for a few minutes and continue with a same-site GET (303),
 * where the state cookie is available again.
 */
export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const pick = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '')
  const handle = randomId(24)
  await putTransient(
    event,
    `apple-post:${handle}`,
    {
      code: pick('code'),
      state: pick('state'),
      user: pick('user'),
      error: pick('error'),
    },
    300,
  )
  return sendRedirect(event, `/api/auth/apple/callback?handle=${encodeURIComponent(handle)}`, 303)
})
