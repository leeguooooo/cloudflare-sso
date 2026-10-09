/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s — what every authenticator app speaks), the secret's
 * encryption at rest, and one-time recovery codes. Pure functions: no h3, no database.
 */

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const base32Encode = (bytes: Uint8Array) => {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export const base32Decode = (text: string) => {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) throw new Error('Invalid base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** A new 160-bit secret, base32 (the form authenticator apps take). */
export const generateTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)))

export const totpStep = (nowSeconds: number) => Math.floor(nowSeconds / STEP_SECONDS)

/** The code for one time step. */
export const totpCode = async (secret: string, step: number) => {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))
  const offset = mac[mac.length - 1] & 15
  const binary = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Checks `code` against the current step and one step either side (clock drift). Returns the
 * matching step, so the caller can refuse it next time (no replay), or null.
 */
export const verifyTotp = async (secret: string, code: string, nowSeconds: number, notAfterStep = -1) => {
  const digits = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  const current = totpStep(nowSeconds)
  for (const step of [current - 1, current, current + 1]) {
    if (step <= notAfterStep) continue
    if ((await totpCode(secret, step)) === digits) return step
  }
  return null
}

export const otpauthUri = (secret: string, accountName: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${accountName}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`

// ---- secret encryption (AES-GCM, key derived from a server secret) ----

const textEncoder = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const deriveKey = async (material: string) => {
  const base = await crypto.subtle.importKey('raw', textEncoder.encode(material), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: textEncoder.encode('leeguoo-sso-mfa'), info: textEncoder.encode('totp-secret-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export const encryptSecret = async (material: string, plaintext: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(material), textEncoder.encode(plaintext)))
  return `v1.${b64(iv)}.${b64(sealed)}`
}

export const decryptSecret = async (material: string, sealed: string) => {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) throw new Error('Unknown secret format')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await deriveKey(material), unb64(data))
  return new TextDecoder().decode(plain)
}

// ---- recovery codes ----

// 32 symbols, so `byte % 32` is unbiased. No i/l/o/1, so nothing reads as another character.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz023456789'

/** Ten codes like `k7mq-x3tn`: 40 bits each, typed rarely, read off paper. */
export const generateRecoveryCodes = (count = 10) =>
  Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('')
    return `${chars.slice(0, 4)}-${chars.slice(4)}`
  })

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Recovery codes are random, so a keyed SHA-256 is enough (no slow hash needed). */
export const hashRecoveryCode = async (material: string, code: string) => {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(`recovery:${material}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(normalizeRecoveryCode(code))))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}
