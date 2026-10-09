import { defineEventHandler, setResponseHeader } from 'h3'
import { createChallenge, rpIdFor } from '../../../../utils/passkeys'

/**
 * POST /api/auth/passkey/options → `{ challenge_id, publicKey }` for navigator.credentials.get().
 * Discoverable credentials: no account is named, the authenticator offers the user's passkeys.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const { id, challenge } = await createChallenge(event, 'login', null)
  return {
    challenge_id: id,
    publicKey: { challenge, rpId: rpIdFor(event), timeout: 120000, userVerification: 'preferred', allowCredentials: [] },
  }
})
