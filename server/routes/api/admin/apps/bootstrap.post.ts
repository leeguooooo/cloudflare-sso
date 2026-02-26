import { createError, defineEventHandler, readBody } from 'h3'
import { getDb } from '../../../../utils/env'
import { writeAuditLog } from '../../../../utils/audit'
import { requireAnyAdmin } from '../../../../utils/guard'
import {
  ensureClientManagementSchema,
  ensureGlobalIdentitySchema,
  ensureTenantExists,
  findUserById,
  provisionTenantUserForGlobalAccount,
} from '../../../../utils/identity'

type BootstrapBody = {
  app_key?: string
  app_keys?: string[]
}

type ClientSeed = {
  client_id: string
  name: string
  redirect_uris: string[]
}

type AppSeed = {
  tenantId: string
  tenantName: string
  clients: ClientSeed[]
}

const APP_SEEDS: Record<string, AppSeed> = {
  blog: {
    tenantId: 'tenant-blog',
    tenantName: 'Blog Tenant',
    clients: [
      {
        client_id: 'blog-web',
        name: 'Blog Web',
        redirect_uris: ['http://localhost:4321/auth/callback'],
      },
    ],
  },
  paste: {
    tenantId: 'tenant-paste',
    tenantName: 'Paste Tenant',
    clients: [
      {
        client_id: 'paste-web',
        name: 'Paste Web',
        redirect_uris: ['http://localhost:5173/auth/callback'],
      },
      {
        client_id: 'paste-macos',
        name: 'Paste macOS',
        redirect_uris: ['paste://oauth/callback'],
      },
    ],
  },
  misonote: {
    tenantId: 'tenant-misonote',
    tenantName: 'Misonote Tenant',
    clients: [
      {
        client_id: 'misonote-app-web',
        name: 'Misonote App Web',
        redirect_uris: ['http://localhost:3000/auth/callback', 'https://app.misonote.com/auth/callback'],
      },
      {
        client_id: 'misonote-paste-web',
        name: 'Misonote Paste Web',
        redirect_uris: [
          'http://localhost:3000/',
          'http://localhost:3000/auth/callback',
          'https://paste-web.misonote.com/',
          'https://paste-web.misonote.com/auth/callback',
        ],
      },
      {
        client_id: 'misonote-choose-browser-web',
        name: 'Misonote Choose Browser Web',
        redirect_uris: ['http://localhost:5174/auth/callback', 'https://choose-browser.misonote.com/auth/callback'],
      },
      {
        client_id: 'misonote-blog-web',
        name: 'Misonote Blog Web',
        redirect_uris: ['http://localhost:4321/auth/callback', 'https://blog.misonote.com/auth/callback'],
      },
    ],
  },
  cherry: {
    tenantId: 'tenant-cherry',
    tenantName: 'Cherry Tenant',
    clients: [
      {
        client_id: 'cherry-admin-web',
        name: 'Cherry Admin Web',
        redirect_uris: ['http://localhost:5174/auth/callback'],
      },
      {
        client_id: 'cherry-consumer',
        name: 'Cherry Consumer',
        redirect_uris: ['cherry-consumer://oauth/callback'],
      },
      {
        client_id: 'cherry-leader',
        name: 'Cherry Leader',
        redirect_uris: ['cherry-leader://oauth/callback'],
      },
      {
        client_id: 'cherry-admin-mp',
        name: 'Cherry Admin Mini Program',
        redirect_uris: ['https://localhost.invalid/cherry-admin-mp/callback'],
      },
    ],
  },
}

const ensurePermission = async (db: D1Database, tenantId: string, action: string, resource: string) => {
  const existing = await db
    .prepare(`SELECT id FROM permissions WHERE tenant_id = ? AND action = ? AND resource = ?`)
    .bind(tenantId, action, resource)
    .first<{ id: string }>()
  if (existing?.id) return existing.id
  const permId = crypto.randomUUID()
  await db.prepare(`INSERT INTO permissions (id, tenant_id, action, resource) VALUES (?, ?, ?, ?)`).bind(permId, tenantId, action, resource).run()
  return permId
}

const ensureRole = async (db: D1Database, tenantId: string, name: string, description: string) => {
  const existing = await db
    .prepare(`SELECT id FROM roles WHERE tenant_id = ? AND name = ?`)
    .bind(tenantId, name)
    .first<{ id: string }>()
  if (existing?.id) return existing.id
  const roleId = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO roles (id, tenant_id, name, description, built_in) VALUES (?, ?, ?, ?, 1)`)
    .bind(roleId, tenantId, name, description)
    .run()
  return roleId
}

const ensureClient = async (db: D1Database, tenantId: string, seed: ClientSeed) => {
  const existing = await db
    .prepare(`SELECT id, client_id FROM clients WHERE client_id = ?`)
    .bind(seed.client_id)
    .first<{ id: string; client_id: string }>()
  if (existing?.id) return existing.id

  const clientId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO clients
       (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, status, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'authorization_code pkce refresh_token', 'openid profile email', 1, 'active', strftime('%s', 'now'))`,
    )
    .bind(clientId, tenantId, seed.client_id, seed.name, JSON.stringify(seed.redirect_uris))
    .run()

  return clientId
}

export default defineEventHandler(async (event) => {
  const principal = await requireAnyAdmin(event)
  const bootstrapRunId = crypto.randomUUID()
  const body = (await readBody(event).catch(() => ({}))) as BootstrapBody
  const rawAppKeys = Array.isArray(body.app_keys) ? body.app_keys : body.app_key ? [body.app_key] : []
  const appKeys = Array.from(
    new Set(
      rawAppKeys
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  )
  if (appKeys.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'app_key or app_keys required' })
  }
  for (const key of appKeys) {
    if (!APP_SEEDS[key]) {
      throw createError({ statusCode: 400, statusMessage: `Unknown app key: ${key}` })
    }
  }

  await ensureGlobalIdentitySchema(event)
  await ensureClientManagementSchema(event)

  const db = getDb(event)
  const caller = await findUserById(event, principal.sub)
  const results: Array<{
    app_key: string
    tenant_id: string
    client_ids: string[]
    default_roles: string[]
    provisioned_admin_user_id: string | null
  }> = []

  for (const appKey of appKeys) {
    const appSeed = APP_SEEDS[appKey]
    await ensureTenantExists(event, appSeed.tenantId, appSeed.tenantName)

    const adminRoleId = await ensureRole(db, appSeed.tenantId, 'admin', 'Tenant admin role')
    const userRoleId = await ensureRole(db, appSeed.tenantId, 'user', 'Default user role')

    const permissionIds = await Promise.all([
      ensurePermission(db, appSeed.tenantId, 'manage', 'users'),
      ensurePermission(db, appSeed.tenantId, 'view', 'logs'),
      ensurePermission(db, appSeed.tenantId, 'view', 'analytics'),
    ])

    for (const permissionId of permissionIds) {
      await db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`).bind(adminRoleId, permissionId).run()
    }

    for (const clientSeed of appSeed.clients) {
      const internalClientId = await ensureClient(db, appSeed.tenantId, clientSeed)
      await db.prepare(`INSERT OR IGNORE INTO client_roles (client_id, role_id) VALUES (?, ?)`).bind(internalClientId, adminRoleId).run()
      await db.prepare(`INSERT OR IGNORE INTO client_roles (client_id, role_id) VALUES (?, ?)`).bind(internalClientId, userRoleId).run()
    }

    let provisionedAdminUserId: string | null = null
    if (caller?.global_account_id) {
      const provisioned = await provisionTenantUserForGlobalAccount(event, {
        tenantId: appSeed.tenantId,
        globalAccountId: caller.global_account_id,
        email: caller.email,
        locale: caller.locale || 'en',
      })
      provisionedAdminUserId = provisioned.user.id
      await db
        .prepare(`INSERT OR IGNORE INTO user_roles (id, user_id, role_id, client_id) VALUES (?, ?, ?, NULL)`)
        .bind(crypto.randomUUID(), provisioned.user.id, adminRoleId)
        .run()
    }

    await writeAuditLog(event, {
      tenantId: appSeed.tenantId,
      userId: principal.sub,
      action: 'admin.apps.bootstrap',
      payload: {
        run_id: bootstrapRunId,
        app_key: appKey,
        tenant_id: appSeed.tenantId,
        clients: appSeed.clients.map((c) => c.client_id),
        provisioned_admin_user_id: provisionedAdminUserId,
      },
    })

    results.push({
      app_key: appKey,
      tenant_id: appSeed.tenantId,
      client_ids: appSeed.clients.map((c) => c.client_id),
      default_roles: ['admin', 'user'],
      provisioned_admin_user_id: provisionedAdminUserId,
      bootstrap_run_id: bootstrapRunId,
    })
  }

  if (results.length === 1) {
    return results[0]
  }

  return {
    app_keys: appKeys,
    bootstrap_run_id: bootstrapRunId,
    results,
  }
})
