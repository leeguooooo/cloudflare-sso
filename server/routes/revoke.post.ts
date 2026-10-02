import { defineEventHandler, getRequestHeader, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { getDb } from '../utils/env'
import { hashToken } from '../utils/crypto'
import { ensureSessionSchema, revokeSession } from '../utils/auth'
import { verifyJwt } from '../utils/jwt'
import { writeAuditLog } from '../utils/audit'
import { verifyClientSecret } from '../utils/client-auth'
import { OAuthError, readClientCredentials, sendOAuthError } from '../utils/oauth-error'

/**
 * RFC 7009 token revocation. Accepts a refresh token or an access token issued to the calling
 * client and revokes the whole session behind it. Unknown, expired or foreign tokens still get
 * 200, as the RFC requires, so the endpoint cannot be used to probe tokens.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    const db = getDb(event)
    await ensureSessionSchema(event)
    const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
    const token = typeof body.token === 'string' ? body.token : ''
    const { clientId, clientSecret } = readClientCredentials(getRequestHeader(event, 'authorization'), body)
    if (!clientId) throw new OAuthError('invalid_client', 'client_id required')
    if (!token) throw new OAuthError('invalid_request', 'token required')

    const client = await db
      .prepare(`SELECT id, client_id, client_secret FROM clients WHERE client_id = ?`)
      .bind(clientId)
      .first<{ id: string; client_id: string; client_secret: string | null }>()
    if (!client) throw new OAuthError('invalid_client', 'Unknown client')
    if (client.client_secret && !(await verifyClientSecret(clientSecret, client.client_secret))) {
      throw new OAuthError('invalid_client', 'Invalid client secret')
    }

    let session: { id: string; tenant_id: string; user_id: string } | null = null
    if (token.split('.').length === 3) {
      try {
        const payload = await verifyJwt(event, token, { ignoreExpiry: true })
        if (payload.aud === client.client_id && typeof payload.sid === 'string') {
          session = await db
            .prepare(`SELECT id, tenant_id, user_id FROM sessions WHERE id = ? AND client_id = ? AND revoked_at IS NULL`)
            .bind(payload.sid, client.id)
            .first()
        }
      } catch {
        session = null
      }
    } else {
      const hash = await hashToken(token)
      session = await db
        .prepare(
          `SELECT id, tenant_id, user_id FROM sessions
           WHERE (refresh_token_hash = ? OR previous_refresh_token_hash = ?) AND client_id = ? AND revoked_at IS NULL`,
        )
        .bind(hash, hash, client.id)
        .first()
    }

    if (session) {
      await revokeSession(event, session.id)
      await writeAuditLog(event, {
        tenantId: session.tenant_id,
        userId: session.user_id,
        action: 'auth.token.revoke',
        payload: { client_id: client.client_id, session_id: session.id },
      })
    }
    setResponseStatus(event, 200)
    return {}
  } catch (error) {
    if (error instanceof OAuthError) return sendOAuthError(event, error)
    throw error
  }
})
