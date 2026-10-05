import { defineEventHandler, getQuery, setResponseHeader, setResponseStatus } from 'h3'
import { nowInSeconds } from '../../../../utils/crypto'
import { describeDeviceClient, findDeviceCodeByUserCode, formatUserCode, getDeviceApprover, normalizeUserCode } from '../../../../utils/device'
import { consumeRateLimit, requestIp } from '../../../../utils/rate-limit'

/**
 * GET /api/auth/device/lookup[?user_code=XXXX-XXXX] — what the /device page needs: whether the
 * browser is signed in (and as whom) and, for a user code, the app and device asking for access.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const approver = await getDeviceApprover(event)
  const base = { signed_in: Boolean(approver), email: approver?.email || null }
  const raw = getQuery(event).user_code
  if (raw === undefined || raw === '') return { ...base, user_code: null }

  try {
    await consumeRateLimit(event, 'device_lookup', requestIp(event), 30, 600)
  } catch {
    setResponseStatus(event, 429)
    return { ...base, error: 'too_many_requests', error_description: 'Too many attempts, try again later' }
  }
  const userCode = normalizeUserCode(raw)
  const row = userCode ? await findDeviceCodeByUserCode(event, userCode) : null
  if (!row || (row.client_status || 'active') !== 'active') {
    setResponseStatus(event, 404)
    return { ...base, error: 'invalid_user_code', error_description: 'Unknown code' }
  }
  const expired = row.status === 'pending' && nowInSeconds() > row.expires_at
  return {
    ...base,
    user_code: formatUserCode(row.user_code),
    ...describeDeviceClient(row),
    status: expired ? 'expired' : row.status,
    expires_in: Math.max(0, row.expires_at - nowInSeconds()),
  }
})
