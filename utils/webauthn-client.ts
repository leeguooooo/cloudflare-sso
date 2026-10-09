/**
 * Browser side of passkeys: turns the server's JSON options (base64url strings) into the
 * ArrayBuffers navigator.credentials wants, and the resulting credential back into JSON.
 */

const toB64url = (buffer: ArrayBuffer | null | undefined) => {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64url = (text: string) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

export const passkeysSupported = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials)

/** Passkeys only work on the RP ID's host (or its subdomains). */
export const hostFitsRpId = (rpId: string) => {
  const host = window.location.hostname
  return host === rpId || host.endsWith(`.${rpId}`)
}

type CreationOptionsJSON = {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout?: number
  attestation?: AttestationConveyancePreference
  authenticatorSelection?: AuthenticatorSelectionCriteria
  excludeCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>
}

type RequestOptionsJSON = { challenge: string; rpId: string; timeout?: number; userVerification?: UserVerificationRequirement }

export const createPasskey = async (options: CreationOptionsJSON) => {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromB64url(options.challenge),
      user: { ...options.user, id: fromB64url(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({ type: c.type, id: fromB64url(c.id), transports: c.transports as AuthenticatorTransport[] })),
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('cancelled')
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: { clientDataJSON: toB64url(response.clientDataJSON), attestationObject: toB64url(response.attestationObject) },
    transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
  }
}

export const getPasskey = async (options: RequestOptionsJSON) => {
  const credential = (await navigator.credentials.get({
    publicKey: { ...options, challenge: fromB64url(options.challenge), allowCredentials: [] },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('cancelled')
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      authenticatorData: toB64url(response.authenticatorData),
      signature: toB64url(response.signature),
      userHandle: toB64url(response.userHandle),
    },
  }
}

/** The user dismissed the browser sheet (not an error worth showing). */
export const isPasskeyCancel = (error: unknown) => {
  const name = (error as { name?: string })?.name
  return name === 'NotAllowedError' || name === 'AbortError' || (error as Error)?.message === 'cancelled'
}
