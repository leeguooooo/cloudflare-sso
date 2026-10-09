/** A software passkey authenticator (ES256, "none" attestation) for WebAuthn tests. */
import { b64url, sha256 } from '../../server/utils/webauthn'

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [key: string]: Cbor }

const head = (major: number, length: number) => {
  if (length < 24) return [(major << 5) | length]
  if (length < 256) return [(major << 5) | 24, length]
  return [(major << 5) | 25, length >> 8, length & 255]
}

export const encodeCbor = (value: Cbor): Uint8Array => {
  const out: number[] = []
  const write = (v: Cbor) => {
    if (typeof v === 'number') out.push(...(v >= 0 ? head(0, v) : head(1, -1 - v)))
    else if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v)
      out.push(...head(3, bytes.length), ...bytes)
    } else if (v instanceof Uint8Array) out.push(...head(2, v.length), ...v)
    else if (Array.isArray(v)) {
      out.push(...head(4, v.length))
      v.forEach(write)
    } else {
      const entries = v instanceof Map ? [...v.entries()] : Object.entries(v)
      out.push(...head(5, entries.length))
      for (const [k, item] of entries) {
        write(k as Cbor)
        write(item as Cbor)
      }
    }
  }
  write(value)
  return new Uint8Array(out)
}

const rawToDer = (raw: Uint8Array) => {
  const int = (bytes: Uint8Array) => {
    let b = bytes
    while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.slice(1)
    if (b[0] & 0x80) b = new Uint8Array([0, ...b])
    return [0x02, b.length, ...b]
  }
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]
  return new Uint8Array([0x30, body.length, ...body])
}

export const createAuthenticator = async (rpId: string, origin: string) => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64url'))
  const credentialId = crypto.getRandomValues(new Uint8Array(16))
  let counter = 0
  let userHandle = ''
  const rpIdHash = await sha256(rpId)

  const register = async (options: { challenge: string; user: { id: string } }, overrides: { origin?: string; rpId?: string } = {}) => {
    userHandle = options.user.id
    const cose = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, fromB64(jwk.x!)],
      [-3, fromB64(jwk.y!)],
    ])
    const authData = new Uint8Array([
      ...(overrides.rpId ? await sha256(overrides.rpId) : rpIdHash),
      0x45,
      0, 0, 0, 0,
      ...new Uint8Array(16),
      0, credentialId.length,
      ...credentialId,
      ...encodeCbor(cose),
    ])
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: overrides.origin || origin }))
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: 'public-key',
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(encodeCbor({ fmt: 'none', attStmt: {}, authData })) },
      transports: ['internal'],
    }
  }

  const assert = async (options: { challenge: string }, overrides: { counter?: number; origin?: string } = {}) => {
    counter = overrides.counter ?? counter + 1
    const authData = new Uint8Array([...rpIdHash, 0x05, (counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255])
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: overrides.origin || origin }))
    const signed = new Uint8Array([...authData, ...(await sha256(clientDataJSON))])
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed))
    return {
      id: b64url(credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(rawToDer(raw)),
        userHandle: userHandle,
      },
    }
  }

  return { register, assert, credentialId: b64url(credentialId) }
}
