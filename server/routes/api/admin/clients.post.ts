import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../utils/env'
import { writeAuditLog } from '../../../utils/audit'
import { requireTenantAdmin } from '../../../utils/guard'
import { ensureClientManagementSchema } from '../../../utils/identity'

type ClientManageBody = {
  action?: 'create' | 'update' | 'disable' | 'enable'
  tenant_id?: string
  id?: string
  client_id?: string
  client_secret?: string | null
  name?: string
  redirect_uris?: string[]
  grant_types?: string
  scope?: string
  first_party?: boolean
}

const normalizeRedirectUris = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as ClientManageBody
  const action = body.action || 'create'
  const tenantId = body.tenant_id?.trim()
  if (!tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'tenant_id required' })
  }
  const principal = await requireTenantAdmin(event, tenantId)
  await ensureClientManagementSchema(event)
  const db = getDb(event)

  if (action === 'create') {
    const clientPublicId = body.client_id?.trim()
    const name = body.name?.trim()
    const redirectUris = normalizeRedirectUris(body.redirect_uris)
    const grantTypes = body.grant_types?.trim() || 'authorization_code pkce refresh_token'
    const scope = body.scope?.trim() || 'openid profile email'
    const firstParty = body.first_party === false ? 0 : 1
    if (!clientPublicId || !name || redirectUris.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'client_id, name, redirect_uris are required' })
    }

    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO clients
         (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', strftime('%s', 'now'))`,
      )
      .bind(
        id,
        tenantId,
        clientPublicId,
        body.client_secret || null,
        name,
        JSON.stringify(redirectUris),
        grantTypes,
        scope,
        firstParty,
      )
      .run()

    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: 'admin.client.create',
      payload: {
        id,
        client_id: clientPublicId,
        name,
        redirect_uris: redirectUris,
        grant_types: grantTypes,
        scope,
        first_party: firstParty === 1,
      },
    })

    return { success: true, action, id }
  }

  const clientId = body.id?.trim()
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }
  const existing = await db
    .prepare(
      `SELECT id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, COALESCE(status, 'active') as status
       FROM clients
       WHERE id = ?`,
    )
    .bind(clientId)
    .first<{
      id: string
      tenant_id: string
      client_id: string
      client_secret: string | null
      name: string
      redirect_uris: string
      grant_types: string
      scope: string
      first_party: number
      status: string
    }>()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }
  if (existing.tenant_id !== tenantId) {
    throw createError({ statusCode: 403, statusMessage: 'Tenant mismatch' })
  }

  if (action === 'disable' || action === 'enable') {
    const nextStatus = action === 'disable' ? 'disabled' : 'active'
    await db
      .prepare(`UPDATE clients SET status = ?, updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(nextStatus, clientId)
      .run()

    await writeAuditLog(event, {
      tenantId,
      userId: principal.sub,
      action: action === 'disable' ? 'admin.client.disable' : 'admin.client.enable',
      payload: { id: clientId, client_id: existing.client_id, status: nextStatus },
    })

    return { success: true, action, id: clientId, status: nextStatus }
  }

  if (action !== 'update') {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported action' })
  }

  const nextClientPublicId = body.client_id?.trim() || existing.client_id
  const nextName = body.name?.trim() || existing.name
  const nextRedirectUris = normalizeRedirectUris(body.redirect_uris)
  const nextGrantTypes = body.grant_types?.trim() || existing.grant_types
  const nextScope = body.scope?.trim() || existing.scope
  const nextFirstParty = typeof body.first_party === 'boolean' ? (body.first_party ? 1 : 0) : existing.first_party
  const nextClientSecret =
    typeof body.client_secret === 'string'
      ? (body.client_secret.trim() ? body.client_secret.trim() : null)
      : existing.client_secret
  const redirectUriJson = nextRedirectUris.length ? JSON.stringify(nextRedirectUris) : existing.redirect_uris

  await db
    .prepare(
      `UPDATE clients
       SET client_id = ?, client_secret = ?, name = ?, redirect_uris = ?, grant_types = ?, scope = ?, first_party = ?, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
    )
    .bind(
      nextClientPublicId,
      nextClientSecret,
      nextName,
      redirectUriJson,
      nextGrantTypes,
      nextScope,
      nextFirstParty,
      clientId,
    )
    .run()

  await writeAuditLog(event, {
    tenantId,
    userId: principal.sub,
    action: 'admin.client.update',
    payload: {
      id: clientId,
      client_id: nextClientPublicId,
      name: nextName,
      grant_types: nextGrantTypes,
      scope: nextScope,
      first_party: nextFirstParty === 1,
      redirect_uris: JSON.parse(redirectUriJson),
    },
  })

  return { success: true, action, id: clientId }
})
