import { defineEventHandler, getQuery } from 'h3'
import { getDb } from '../../../../utils/env'
import { requireAnyAdmin } from '../../../../utils/guard'

type AuditRow = {
  id: string
  tenant_id?: string | null
  user_id?: string | null
  payload_json: string
  created_at: number
}

type BootstrapPayload = {
  run_id?: string
  app_key?: string
  tenant_id?: string
  clients?: string[]
  provisioned_admin_user_id?: string | null
}

const parsePayload = (raw: string): BootstrapPayload => {
  try {
    const parsed = JSON.parse(raw || '{}') as BootstrapPayload
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export default defineEventHandler(async (event) => {
  await requireAnyAdmin(event)
  const query = getQuery(event)
  const runId = String(query.run_id || '').trim()
  const limitRaw = Number(query.limit || 20)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20

  const db = getDb(event)
  const rows = await db
    .prepare(
      `SELECT id, tenant_id, user_id, payload_json, created_at
       FROM audit_logs
       WHERE action = 'admin.apps.bootstrap'
         AND (? = '' OR json_extract(payload_json, '$.run_id') = ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(runId, runId, limit)
    .all<AuditRow>()

  const receipts = (rows.results || []).map((row) => {
    const payload = parsePayload(row.payload_json)
    return {
      audit_id: row.id,
      bootstrap_run_id: payload.run_id || '',
      app_key: payload.app_key || '',
      tenant_id: payload.tenant_id || row.tenant_id || '',
      clients: Array.isArray(payload.clients) ? payload.clients : [],
      provisioned_admin_user_id: payload.provisioned_admin_user_id || null,
      triggered_by_user_id: row.user_id || null,
      created_at: row.created_at,
    }
  })

  return {
    run_id: runId || null,
    receipts,
  }
})

