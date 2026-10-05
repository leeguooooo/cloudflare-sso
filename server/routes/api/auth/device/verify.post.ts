import { defineEventHandler, getRequestHeader, getRequestHost, H3Event, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { assertUserActive, getIssuer } from '../../../../utils/auth'
import { nowInSeconds } from '../../../../utils/crypto'
import { writeAuditLog } from '../../../../utils/audit'
import { decideDeviceCode, describeDeviceClient, findDeviceCodeByUserCode, getDeviceApprover, normalizeUserCode } from '../../../../utils/device'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'

const originHost = (origin: string) => {
  try {
    return new URL(origin).host
  } catch {
    return ''
  }
}

const fail = (event: H3Event, status: number, error: string, description: string) => {
  setResponseStatus(event, status)
  return { error, error_description: description }
}

/**
 * POST /api/auth/device/verify { user_code, action: "approve" | "deny" } — the signed-in user
 * decides a pending device code. Authenticated only by the first-party session cookie.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  // The cookie is SameSite=Lax; refusing foreign origins also stops form posts from other sites.
  const origin = getRequestHeader(event, 'origin')
  if (origin && ![getRequestHost(event), originHost(getIssuer(event))].includes(originHost(origin))) return fail(event, 403, 'invalid_origin', 'Cross-origin request refused')

  const body = ((await readBody(event).catch(() => ({}))) || {}) as { user_code?: unknown; action?: unknown }
  const action = body.action === 'approve' || body.action === 'deny' ? body.action : ''
  if (!action) return fail(event, 400, 'invalid_request', 'action must be approve or deny')

  try {
    await consumeRateLimit(event, 'device_verify', requestIp(event), 20, 600)
  } catch {
    return fail(event, 429, 'too_many_requests', 'Too many attempts, try again later')
  }

  const approver = await getDeviceApprover(event)
  if (!approver) return fail(event, 401, 'login_required', 'Sign in first')

  const userCode = normalizeUserCode(body.user_code)
  const row = userCode ? await findDeviceCodeByUserCode(event, userCode) : null
  if (!row || (row.client_status || 'active') !== 'active') return fail(event, 404, 'invalid_user_code', 'Unknown code')
  if (row.status !== 'pending') return fail(event, 409, 'already_handled', 'This code was already used')
  if (nowInSeconds() > row.expires_at) return fail(event, 410, 'expired_user_code', 'This code has expired')

  if (action === 'approve') {
    if (!approver.globalAccountId) return fail(event, 403, 'account_unavailable', 'This account cannot sign in to other apps')
    try {
      await assertUserActive(event, approver.userId)
    } catch {
      return fail(event, 403, 'account_unavailable', 'Account disabled')
    }
  }

  const decided = await decideDeviceCode(
    event,
    row.id,
    action === 'approve' ? { approve: true, globalAccountId: approver.globalAccountId!, authTime: approver.authTime } : { approve: false },
  )
  if (!decided) return fail(event, 409, 'already_handled', 'This code was already used')

  const client = describeDeviceClient(row)
  await writeAuditLog(event, {
    tenantId: null,
    userId: approver.userId,
    action: action === 'approve' ? 'auth.device.approve' : 'auth.device.deny',
    payload: { client_id: client.client_id, global_account_id: approver.globalAccountId },
  })

  return { ok: true, status: action === 'approve' ? 'approved' : 'denied', ...client }
})
