const textEncoder = new TextEncoder()

const DEFAULT_PBKDF2_ITERATIONS = 120_000
const PBKDF2_HASH_BYTE_LENGTH = 32

export const nowInSeconds = () => Math.floor(Date.now() / 1000)

export const base64UrlEncode = (input: ArrayBuffer | Uint8Array) => {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary =
    typeof atob === 'function'
      ? atob(normalized)
      : Buffer.from(normalized, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export const randomId = (length = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return base64UrlEncode(bytes)
}

export const hashToken = async (token: string) => {
  const buffer = textEncoder.encode(token)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return base64UrlEncode(digest)
}

export const hashPassword = async (password: string, pepper = '') => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterations = DEFAULT_PBKDF2_ITERATIONS
  const derived = await deriveKey(password, pepper, salt, iterations)
  return `pbkdf2$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`
}

export const verifyPassword = async (password: string, hash: string | null, pepper = '') => {
  if (!hash) return false
  const parts = hash.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const [, iterStr, saltB64, hashB64] = parts
  const iterations = Number(iterStr)
  if (!Number.isFinite(iterations)) return false
  const salt = base64UrlDecode(saltB64)
  const expected = base64UrlDecode(hashB64)
  const derived = await deriveKey(password, pepper, salt, iterations)
  if (derived.byteLength !== expected.byteLength) return false
  return crypto.timingSafeEqual ? crypto.timingSafeEqual(derived, expected) : timingSafeEqualPolyfill(derived, expected)
}

const deriveKey = async (password: string, pepper: string, salt: Uint8Array, iterations: number) => {
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password + pepper), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_HASH_BYTE_LENGTH * 8,
  )
  return new Uint8Array(bits)
}

// Fallback for Workers runtimes without timingSafeEqual
const timingSafeEqualPolyfill = (a: Uint8Array, b: Uint8Array) => {
  if (a.byteLength !== b.byteLength) return false
  let out = 0
  for (let i = 0; i < a.byteLength; i += 1) {
    out |= a[i] ^ b[i]
  }
  return out === 0
}
