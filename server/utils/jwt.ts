import { createError, H3Event } from 'h3'
import { base64UrlDecode, base64UrlEncode, nowInSeconds } from './crypto'
import { getEnv } from './env'

type SigningCache = {
  privateKey?: CryptoKey
  publicKey?: CryptoKey
  publicJwk?: JsonWebKey
  kid?: string
}

const signingCache: SigningCache = {}
const textEncoder = new TextEncoder()

export const signJwt = async (
  event: H3Event,
  payload: Record<string, unknown>,
  options?: { expiresInSeconds?: number; issuer?: string; audience?: string },
) => {
  const { privateKey, kid } = await getSigningKeys(event)
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  }
  const now = nowInSeconds()
  const completePayload = {
    iat: now,
    exp: options?.expiresInSeconds ? now + options.expiresInSeconds : undefined,
    iss: options?.issuer,
    aud: options?.audience,
    ...payload,
  }

  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)))
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(completePayload)))
  const toSign = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    textEncoder.encode(toSign),
  )
  const encodedSignature = base64UrlEncode(new Uint8Array(signature))
  return `${toSign}.${encodedSignature}`
}

export const verifyJwt = async (event: H3Event, token: string) => {
  const parts = token.split('.')
  if (parts.length !== 3) throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(encodedHeader)))
  if (header.alg !== 'RS256') throw createError({ statusCode: 400, statusMessage: 'Unsupported alg' })
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(encodedPayload)))
  const signature = base64UrlToBuffer(encodedSignature)
  const { publicKey } = await getSigningKeys(event)
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  )
  if (!ok) throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  if (payload.exp && nowInSeconds() > payload.exp) throw createError({ statusCode: 401, statusMessage: 'Token expired' })
  return payload
}

export const getPublicJwk = async (event: H3Event) => {
  const { publicJwk, kid } = await getSigningKeys(event)
  return { ...publicJwk, kid }
}

const getSigningKeys = async (event: H3Event) => {
  if (signingCache.privateKey && signingCache.publicKey && signingCache.publicJwk && signingCache.kid) {
    return signingCache
  }
  const env = getEnv(event)
  if (!env.JWT_PRIVATE_KEY) {
    throw createError({ statusCode: 500, statusMessage: 'Missing JWT_PRIVATE_KEY in env' })
  }
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.JWT_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['sign'],
  )
  const privateJwk = await crypto.subtle.exportKey('jwk', privateKey)
  const publicJwk = stripPrivate(privateJwk)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  )
  signingCache.privateKey = privateKey
  signingCache.publicKey = publicKey
  signingCache.publicJwk = publicJwk
  signingCache.kid = env.JWT_KID || 'primary'
  return signingCache
}

const pemToArrayBuffer = (pem: string) => {
  const normalized = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '')
  const binary =
    typeof atob === 'function'
      ? atob(normalized)
      : Buffer.from(normalized, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

const stripPrivate = (jwk: JsonWebKey) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { d, p, q, dp, dq, qi, oth, key_ops, ...rest } = jwk
  // Return public key without key_ops, let importKey set it based on usage
  return rest
}

const base64UrlToBuffer = (input: string) => base64UrlDecode(input)
