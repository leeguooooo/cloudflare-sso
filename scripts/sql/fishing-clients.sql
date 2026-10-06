-- Fishing (iOS App Store app, bundle id com.leeguoo.fishing): tenant, roles and OIDC client.
-- Same rows as `POST /api/admin/apps/bootstrap { "app_key": "fishing" }` (minus provisioning the
-- caller as tenant admin). Idempotent: safe to run more than once, never overwrites existing rows.
--
--   pnpm wrangler:config:prod
--   npx wrangler d1 execute DB --remote --file=./scripts/sql/fishing-clients.sql

INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-fishing', 'Fishing');

INSERT OR IGNORE INTO roles (id, tenant_id, name, description, built_in)
  VALUES ('role-fishing-admin', 'tenant-fishing', 'admin', 'Tenant admin role', 1),
         ('role-fishing-user', 'tenant-fishing', 'user', 'Default user role', 1);

INSERT OR IGNORE INTO permissions (id, tenant_id, action, resource)
  VALUES ('perm-fishing-manage-users', 'tenant-fishing', 'manage', 'users'),
         ('perm-fishing-view-logs', 'tenant-fishing', 'view', 'logs'),
         ('perm-fishing-view-analytics', 'tenant-fishing', 'view', 'analytics');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r JOIN permissions p ON p.tenant_id = r.tenant_id
  WHERE r.tenant_id = 'tenant-fishing' AND r.name = 'admin'
    AND (p.action, p.resource) IN (VALUES ('manage', 'users'), ('view', 'logs'), ('view', 'analytics'));

-- iPhone: native Apple sign-in (/api/auth/apple/native), plus authorization code + PKCE through
-- ASWebAuthenticationSession for the other sign-in methods.
INSERT OR IGNORE INTO clients
  (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, status, updated_at)
  VALUES ('client-leeguoo-fishing-ios', 'tenant-fishing', 'leeguoo-fishing-ios', NULL, 'Fishing iOS', '["com.leeguoo.fishing:/oauth/callback"]',
          'authorization_code pkce refresh_token', 'openid profile email', 1, 'active', strftime('%s', 'now'));

INSERT OR IGNORE INTO client_roles (client_id, role_id)
  SELECT c.id, r.id
  FROM clients c JOIN roles r ON r.tenant_id = c.tenant_id
  WHERE c.client_id = 'leeguoo-fishing-ios' AND r.name IN ('admin', 'user');
