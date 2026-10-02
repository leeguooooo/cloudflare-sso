import { hashPassword, verifyPassword } from './crypto'

type PepperEnv = { PASSWORD_PEPPER?: string; PASSWORD_PEPPER_V2?: string }

/**
 * Two pepper generations. `pbkdf2$…` hashes use PASSWORD_PEPPER, whose old value is public
 * (it sat in git history), so once the PASSWORD_PEPPER_V2 secret exists every new hash is
 * written as `pbkdf2v2$…` with it, and legacy hashes are upgraded on the next successful sign-in.
 */
const V2_PREFIX = 'pbkdf2v2$'

export const hashAccountPassword = async (env: PepperEnv, password: string) => {
  if (env.PASSWORD_PEPPER_V2) {
    const hash = await hashPassword(password, env.PASSWORD_PEPPER_V2)
    return `${V2_PREFIX}${hash.slice('pbkdf2$'.length)}`
  }
  return hashPassword(password, env.PASSWORD_PEPPER || '')
}

/** `needsRehash` = the password is right but stored under the legacy pepper. */
export const verifyAccountPassword = async (env: PepperEnv, password: string, stored: string | null | undefined) => {
  if (!stored) return { ok: false, needsRehash: false }
  if (stored.startsWith(V2_PREFIX)) {
    if (!env.PASSWORD_PEPPER_V2) return { ok: false, needsRehash: false }
    const ok = await verifyPassword(password, `pbkdf2$${stored.slice(V2_PREFIX.length)}`, env.PASSWORD_PEPPER_V2)
    return { ok, needsRehash: false }
  }
  const ok = await verifyPassword(password, stored, env.PASSWORD_PEPPER || '')
  return { ok, needsRehash: ok && Boolean(env.PASSWORD_PEPPER_V2) }
}
