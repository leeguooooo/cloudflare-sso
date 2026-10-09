/**
 * Minimal WebAuthn (passkeys) relying-party checks with WebCrypto: CBOR, authenticator data,
 * COSE public keys (ES256, RS256) and assertion signatures. Attestation is not verified
 * (we ask for `attestation: "none"`): a passkey proves possession, not the authenticator model.
 * Pure functions: no h3, no database.
 */

const textEncoder = new TextEncoder()

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const fromB64url = (text: string) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

export const sha256 = async (data: Uint8Array | string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? textEncoder.encode(data) : data))

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i])

// ---- CBOR (the subset WebAuthn uses) ----

export type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<CborValue, CborValue>

/** Decodes one item at `offset`; returns it and where it ended. */
export const decodeCbor = (bytes: Uint8Array, offset = 0): { value: CborValue; end: number } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const head = bytes[offset]
  if (head === undefined) throw new Error('CBOR: unexpected end')
  const major = head >> 5
  const info = head & 31
  let pos = offset + 1
  let length: number
  if (info < 24) length = info
  else if (info === 24) length = bytes[pos++]
  else if (info === 25) (length = view.getUint16(pos)), (pos += 2)
  else if (info === 26) (length = view.getUint32(pos)), (pos += 4)
  else if (info === 27) (length = Number(view.getBigUint64(pos))), (pos += 8)
  else throw new Error('CBOR: indefinite lengths are not supported')

  switch (major) {
    case 0:
      return { value: length, end: pos }
    case 1:
      return { value: -1 - length, end: pos }
    case 2:
      if (pos + length > bytes.length) throw new Error('CBOR: truncated bytes')
      return { value: bytes.slice(pos, pos + length), end: pos + length }
    case 3:
      if (pos + length > bytes.length) throw new Error('CBOR: truncated text')
      return { value: new TextDecoder().decode(bytes.slice(pos, pos + length)), end: pos + length }
    case 4: {
      const items: CborValue[] = []
      for (let i = 0; i < length; i++) {
        const item = decodeCbor(bytes, pos)
        items.push(item.value)
        pos = item.end
      }
      return { value: items, end: pos }
    }
    case 5: {
      const map = new Map<CborValue, CborValue>()
      for (let i = 0; i < length; i++) {
        const key = decodeCbor(bytes, pos)
        const value = decodeCbor(bytes, key.end)
        map.set(key.value, value.value)
        pos = value.end
      }
      return { value: map, end: pos }
    }
    case 7:
      if (info === 20) return { value: false, end: pos }
      if (info === 21) return { value: true, end: pos }
      if (info === 22) return { value: null, end: pos }
      throw new Error('CBOR: unsupported simple value')
    default:
      throw new Error('CBOR: unsupported type')
  }
}

// ---- authenticator data ----

export type AuthenticatorData = {
  rpIdHash: Uint8Array
  userPresent: boolean
  userVerified: boolean
  backupEligible: boolean
  backedUp: boolean
  signCount: number
  credentialId?: Uint8Array
  credentialPublicKey?: Map<CborValue, CborValue>
}

export const parseAuthenticatorData = (data: Uint8Array): AuthenticatorData => {
  if (data.length < 37) throw new Error('authenticatorData too short')
  const flags = data[32]
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const parsed: AuthenticatorData = {
    rpIdHash: data.slice(0, 32),
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    backupEligible: Boolean(flags & 0x08),
    backedUp: Boolean(flags & 0x10),
    signCount: view.getUint32(33),
  }
  if (flags & 0x40) {
    // Attested credential data: aaguid(16) | idLength(2) | id | COSE key
    const idLength = view.getUint16(53)
    parsed.credentialId = data.slice(55, 55 + idLength)
    const key = decodeCbor(data, 55 + idLength)
    if (!(key.value instanceof Map)) throw new Error('credential public key is not a COSE map')
    parsed.credentialPublicKey = key.value
  }
  return parsed
}

// ---- COSE keys ----

export type StoredPublicKey = { alg: -7 | -257; jwk: JsonWebKey }

export const coseToJwk = (cose: Map<CborValue, CborValue>): StoredPublicKey => {
  const kty = cose.get(1)
  const alg = cose.get(3)
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2)
    const y = cose.get(-3)
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('bad EC2 key')
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) } }
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1)
    const e = cose.get(-2)
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) throw new Error('bad RSA key')
    return { alg: -257, jwk: { kty: 'RSA', n: b64url(n), e: b64url(e) } }
  }
  throw new Error('unsupported key type (ES256 or RS256 only)')
}

/** ECDSA signatures arrive DER-encoded; WebCrypto wants r||s (32 bytes each for P-256). */
export const derToRawEcdsa = (der: Uint8Array) => {
  if (der[0] !== 0x30) throw new Error('bad DER signature')
  let pos = 2
  const read = () => {
    if (der[pos] !== 0x02) throw new Error('bad DER integer')
    const length = der[pos + 1]
    let value = der.slice(pos + 2, pos + 2 + length)
    pos += 2 + length
    while (value.length > 32 && value[0] === 0) value = value.slice(1)
    if (value.length > 32) throw new Error('bad DER integer length')
    const out = new Uint8Array(32)
    out.set(value, 32 - value.length)
    return out
  }
  const r = read()
  const s = read()
  const raw = new Uint8Array(64)
  raw.set(r, 0)
  raw.set(s, 32)
  return raw
}

export const verifySignature = async (key: StoredPublicKey, signature: Uint8Array, signedData: Uint8Array) => {
  if (key.alg === -7) {
    const publicKey = await crypto.subtle.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, derToRawEcdsa(signature), signedData)
  }
  const publicKey = await crypto.subtle.importKey('jwk', { ...key.jwk, alg: 'RS256' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedData)
}

// ---- ceremony checks ----

export type ClientData = { type: string; challenge: string; origin: string }

export const parseClientData = (clientDataJSON: Uint8Array): ClientData => {
  const parsed = JSON.parse(new TextDecoder().decode(clientDataJSON)) as Partial<ClientData>
  if (typeof parsed.type !== 'string' || typeof parsed.challenge !== 'string' || typeof parsed.origin !== 'string') {
    throw new Error('bad clientDataJSON')
  }
  return parsed as ClientData
}

/** The page's origin must be the RP ID's host (or a subdomain), over https (http only for localhost). */
export const originAllowed = (origin: string, rpId: string) => {
  try {
    const url = new URL(origin)
    const hostOk = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`)
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
    return hostOk && schemeOk
  } catch {
    return false
  }
}

export type RegistrationResult = { credentialId: string; publicKey: StoredPublicKey; signCount: number; backedUp: boolean; userVerified: boolean }

export const verifyRegistration = async (input: {
  clientDataJSON: Uint8Array
  attestationObject: Uint8Array
  expectedChallenge: string
  rpId: string
}): Promise<RegistrationResult> => {
  const client = parseClientData(input.clientDataJSON)
  if (client.type !== 'webauthn.create') throw new Error('wrong ceremony type')
  if (client.challenge !== input.expectedChallenge) throw new Error('challenge mismatch')
  if (!originAllowed(client.origin, input.rpId)) throw new Error('origin not allowed')
  const attestation = decodeCbor(input.attestationObject).value
  if (!(attestation instanceof Map)) throw new Error('bad attestationObject')
  const authDataBytes = attestation.get('authData')
  if (!(authDataBytes instanceof Uint8Array)) throw new Error('attestationObject has no authData')
  const authData = parseAuthenticatorData(authDataBytes)
  if (!equalBytes(authData.rpIdHash, await sha256(input.rpId))) throw new Error('rpId mismatch')
  if (!authData.userPresent) throw new Error('user not present')
  if (!authData.credentialId || !authData.credentialPublicKey) throw new Error('no credential in authData')
  return {
    credentialId: b64url(authData.credentialId),
    publicKey: coseToJwk(authData.credentialPublicKey),
    signCount: authData.signCount,
    backedUp: authData.backedUp,
    userVerified: authData.userVerified,
  }
}

export const verifyAssertion = async (input: {
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
  expectedChallenge: string
  rpId: string
  publicKey: StoredPublicKey
  storedSignCount: number
}) => {
  const client = parseClientData(input.clientDataJSON)
  if (client.type !== 'webauthn.get') throw new Error('wrong ceremony type')
  if (client.challenge !== input.expectedChallenge) throw new Error('challenge mismatch')
  if (!originAllowed(client.origin, input.rpId)) throw new Error('origin not allowed')
  const authData = parseAuthenticatorData(input.authenticatorData)
  if (!equalBytes(authData.rpIdHash, await sha256(input.rpId))) throw new Error('rpId mismatch')
  if (!authData.userPresent) throw new Error('user not present')
  const signed = new Uint8Array(input.authenticatorData.length + 32)
  signed.set(input.authenticatorData, 0)
  signed.set(await sha256(input.clientDataJSON), input.authenticatorData.length)
  if (!(await verifySignature(input.publicKey, input.signature, signed))) throw new Error('bad signature')
  // A counter that does not move forward (when the authenticator keeps one) means a cloned key.
  if ((authData.signCount > 0 || input.storedSignCount > 0) && authData.signCount <= input.storedSignCount) {
    throw new Error('sign count did not increase')
  }
  return { signCount: authData.signCount, userVerified: authData.userVerified, backedUp: authData.backedUp }
}
