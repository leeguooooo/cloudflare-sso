-- Seed data for local dev/testing (use with D1)
INSERT INTO tenants (id, name, domain) VALUES
  ('tenant-demo', 'Demo Tenant', 'demo.local');

INSERT INTO users (id, tenant_id, email, password_hash, locale, mfa_enforced, status)
VALUES ('user-demo', 'tenant-demo', 'demo@example.com', 'pbkdf2$100000$tRhzCnboEyWytzgFPXREJA$F6zQnlgmC_q3EVIAKTSGYpE8VlN2fDljnMQ85z5i6RI', 'en', 0, 'active');

INSERT INTO credentials (id, user_id, type, secret, meta_json)
VALUES ('cred-demo-password', 'user-demo', 'password', 'pbkdf2$100000$tRhzCnboEyWytzgFPXREJA$F6zQnlgmC_q3EVIAKTSGYpE8VlN2fDljnMQ85z5i6RI', '{}');

INSERT INTO clients (id, tenant_id, client_id, client_secret, name, redirect_uris, grant_types, scope, first_party)
VALUES (
  'client-demo',
  'tenant-demo',
  'demo-web',
  'demo-secret',
  'Demo Web App',
  '["http://localhost:3000/callback"]',
  'authorization_code pkce refresh_token',
  'openid profile email',
  1
);

-- Roles & permissions for demo tenant/client
INSERT INTO roles (id, tenant_id, name, description) VALUES
  ('role-admin', 'tenant-demo', 'admin', 'Full admin access'),
  ('role-analyst', 'tenant-demo', 'analyst', 'Read analytics');

INSERT INTO permissions (id, tenant_id, action, resource) VALUES
  ('perm-manage-users', 'tenant-demo', 'manage', 'users'),
  ('perm-view-logs', 'tenant-demo', 'view', 'logs'),
  ('perm-view-analytics', 'tenant-demo', 'view', 'analytics');

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('role-admin', 'perm-manage-users'),
  ('role-admin', 'perm-view-logs'),
  ('role-admin', 'perm-view-analytics'),
  ('role-analyst', 'perm-view-analytics');

INSERT INTO client_roles (client_id, role_id) VALUES
  ('client-demo', 'role-admin'),
  ('client-demo', 'role-analyst');

INSERT INTO user_roles (user_id, role_id, client_id) VALUES
  ('user-demo', 'role-admin', 'client-demo');
