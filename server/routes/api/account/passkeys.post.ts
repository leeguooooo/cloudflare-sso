import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../utils/account'
import { requireRecentAuth } from '../../../utils/sign-in-methods'
import { writeAuditLog } from '../../../utils/audit'
import { getDb } from '../../../utils/env'
import { createChallenge, ensurePasskeySchema, listPasskeys, registerPasskey, rpIdFor } from '../../../utils/passkeys'
import { b64url } from '../../../utils/webauthn'

type Action = 'register_options' | 'register' | 'rename' | 'delete'

/**
 * POST /api/account/passkeys { action, ... }
 * - `register_options` → `{ challenge_id, publicKey }` for navigator.credentials.create()
 * - `register { challenge_id, credential, name? }`: saves the new passkey
 * - `rename { id, name }`, `delete { id }`
 * Adding and deleting need a sign-in within 15 minutes (`403 reauth_required`).
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const account = ctx.globalAccount
  if (!account?.id) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as { action?: Action; challenge_id?: string; credential?: Record<string, unknown>; name?: string; id?: string }
  setResponseHeader(event, 'cache-control', 'no-store')
  await ensurePasskeySchema(event)
  const db = getDb(event)
  const audit = (action: string, payload: Record<string, unknown> = {}) =>
    writeAuditLog(event, { tenantId: ctx.user.tenant_id, userId: ctx.user.id, action: `account.passkey.${action}`, payload })

  if (body.action === 'register_options') {
    await requireRecentAuth(event, ctx)
    const existing = await listPasskeys(event, account.id)
    const { id, challenge } = await createChallenge(event, 'register', account.id)
    return {
      challenge_id: id,
      publicKey: {
        challenge,
        rp: { id: rpIdFor(event), name: 'leeguoo' },
        user: { id: b64url(new TextEncoder().encode(account.id)), name: account.email, displayName: account.display_name || account.email },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 120000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
        excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id, transports: p.transports })),
      },
    }
  }

  if (body.action === 'register') {
    await requireRecentAuth(event, ctx)
    if (!body.challenge_id || !body.credential) throw createError({ statusCode: 400, statusMessage: 'challenge_id and credential are required' })
    const saved = await registerPasskey(event, { globalAccountId: account.id, challengeId: body.challenge_id, credential: body.credential, name: body.name })
    await audit('add', { passkey_id: saved.id })
    return { passkeys: await listPasskeys(event, account.id) }
  }

  const id = String(body.id || '')
  const owned = await db.prepare(`SELECT id FROM passkeys WHERE id = ? AND global_account_id = ?`).bind(id, account.id).first<{ id: string }>()
  if (!owned) throw createError({ statusCode: 404, statusMessage: 'Passkey not found' })

  if (body.action === 'rename') {
    await db.prepare(`UPDATE passkeys SET name = ? WHERE id = ?`).bind(String(body.name || '').trim().slice(0, 60) || null, id).run()
    return { passkeys: await listPasskeys(event, account.id) }
  }
  if (body.action === 'delete') {
    await requireRecentAuth(event, ctx)
    await db.prepare(`DELETE FROM passkeys WHERE id = ?`).bind(id).run()
    await audit('delete', { passkey_id: id })
    return { passkeys: await listPasskeys(event, account.id) }
  }
  throw createError({ statusCode: 400, statusMessage: 'action must be one of: register_options, register, rename, delete' })
})
