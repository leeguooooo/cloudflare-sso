-- JRKAN (tvOS / iOS / Mac, bundle id com.leeguoo.jrskan.tv): tenant, roles and OIDC clients.
-- Same rows as `POST /api/admin/apps/bootstrap { "app_key": "jrkan" }` (minus provisioning the
-- caller as tenant admin). Idempotent: safe to run more than once, never overwrites existing rows.
--
--   pnpm wrangler:config:prod
--   npx wrangler d1 execute DB --remote --file=./scripts/sql/jrkan-clients.sql

INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-jrkan', 'JRKAN');

INSERT OR IGNORE INTO roles (id, tenant_id, name, description, built_in)
  VALUES ('role-jrkan-admin', 'tenant-jrkan', 'admin', 'Tenant admin role', 1),
         ('role-jrkan-user', 'tenant-jrkan', 'user', 'Default user role', 1);

INSERT OR IGNORE INTO permissions (id, tenant_id, action, resource)
  VALUES ('perm-jrkan-manage-users', 'tenant-jrkan', 'manage', 'users'),
         ('perm-jrkan-view-logs', 'tenant-jrkan', 'view', 'logs'),
         ('perm-jrkan-view-analytics', 'tenant-jrkan', 'view', 'analytics');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r JOIN permissions p ON p.tenant_id = r.tenant_id
  WHERE r.tenant_id = 'tenant-jrkan' AND r.name = 'admin'
    AND (p.action, p.resource) IN (VALUES ('manage', 'users'), ('view', 'logs'), ('view', 'analytics'));

-- Apple TV: device authorization grant (RFC 8628) + refresh, no redirect URIs.
INSERT OR IGNORE INTO clients
  (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, status, updated_at)
  VALUES ('client-leeguoo-jrkan-tv', 'tenant-jrkan', 'leeguoo-jrkan-tv', NULL, 'JRKAN Apple TV', '[]',
          'refresh_token urn:ietf:params:oauth:grant-type:device_code', 'openid profile email', 1, 'active', strftime('%s', 'now'));

-- iPhone / iPad / Mac: authorization code + PKCE through ASWebAuthenticationSession, plus native Apple sign-in.
INSERT OR IGNORE INTO clients
  (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party, status, updated_at)
  VALUES ('client-leeguoo-jrkan-ios', 'tenant-jrkan', 'leeguoo-jrkan-ios', NULL, 'JRKAN iOS/Mac', '["com.leeguoo.jrskan.tv:/oauth/callback"]',
          'authorization_code pkce refresh_token', 'openid profile email', 1, 'active', strftime('%s', 'now'));

INSERT OR IGNORE INTO client_roles (client_id, role_id)
  SELECT c.id, r.id
  FROM clients c JOIN roles r ON r.tenant_id = c.tenant_id
  WHERE c.client_id IN ('leeguoo-jrkan-tv', 'leeguoo-jrkan-ios') AND r.name IN ('admin', 'user');
