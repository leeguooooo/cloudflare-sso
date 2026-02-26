import { getRequestHeader, getRequestIP, H3Event } from 'h3'
import { getDb } from './env'

export const writeAuditLog = async (
  event: H3Event,
  input: {
    tenantId?: string | null
    userId?: string | null
    action: string
    payload?: Record<string, unknown>
  },
) => {
  const db = getDb(event)
  await db
    .prepare(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip, user_agent, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.tenantId || null,
      input.userId || null,
      input.action,
      getRequestIP(event) || '',
      getRequestHeader(event, 'user-agent') || '',
      JSON.stringify(input.payload || {}),
    )
    .run()
}
