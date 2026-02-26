-- Seed data for local dev/testing (use with D1)
INSERT INTO tenants (id, name, domain) VALUES
  ('tenant-demo', 'Demo Tenant', 'demo.local');

INSERT INTO global_accounts (id, email, password_hash, locale, status)
VALUES ('ga-demo', 'demo@example.com', 'pbkdf2$100000$tRhzCnboEyWytzgFPXREJA$F6zQnlgmC_q3EVIAKTSGYpE8VlN2fDljnMQ85z5i6RI', 'en', 'active');

INSERT INTO users (id, tenant_id, global_account_id, email, password_hash, locale, mfa_enforced, status)
VALUES ('user-demo', 'tenant-demo', 'ga-demo', 'demo@example.com', 'pbkdf2$100000$tRhzCnboEyWytzgFPXREJA$F6zQnlgmC_q3EVIAKTSGYpE8VlN2fDljnMQ85z5i6RI', 'en', 0, 'active');

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

INSERT INTO user_roles (id, user_id, role_id, client_id) VALUES
  ('ur-demo-admin', 'user-demo', 'role-admin', 'client-demo');

-- Billing / entitlement demo seed
INSERT INTO products (id, tenant_id, product_key, name, app_key, status, meta_json)
VALUES
  ('prod-blog', 'tenant-demo', 'blog-premium', 'Blog Premium', 'blog', 'active', '{}'),
  ('prod-paste', 'tenant-demo', 'paste-pro', 'Paste Pro', 'paste', 'active', '{}');

INSERT INTO plans (
  id,
  tenant_id,
  product_id,
  plan_key,
  name,
  billing_cycle,
  currency,
  amount_minor,
  trial_days,
  entitlement_keys_json,
  status,
  meta_json
)
VALUES
  (
    'plan-blog-yearly',
    'tenant-demo',
    'prod-blog',
    'blog-yearly',
    'Blog Yearly',
    'yearly',
    'USD',
    4900,
    0,
    '["blog.read.premium"]',
    'active',
    '{}'
  ),
  (
    'plan-paste-monthly',
    'tenant-demo',
    'prod-paste',
    'paste-monthly',
    'Paste Monthly',
    'monthly',
    'USD',
    900,
    7,
    '["membership.all_apps","paste.pro"]',
    'active',
    '{}'
  );

INSERT INTO subscriptions (
  id,
  tenant_id,
  user_id,
  plan_id,
  provider,
  provider_ref,
  status,
  started_at,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  meta_json
)
VALUES
  (
    'sub-demo-paste',
    'tenant-demo',
    'user-demo',
    'plan-paste-monthly',
    'internal',
    'sub_internal_demo_001',
    'active',
    strftime('%s', 'now') - 86400,
    strftime('%s', 'now') - 86400,
    strftime('%s', 'now') + 2592000,
    0,
    '{}'
  );

INSERT INTO entitlements (
  id,
  tenant_id,
  user_id,
  subscription_id,
  entitlement_key,
  source,
  status,
  valid_from,
  valid_to,
  meta_json
)
VALUES
  (
    'ent-demo-all-apps',
    'tenant-demo',
    'user-demo',
    'sub-demo-paste',
    'membership.all_apps',
    'plan',
    'granted',
    strftime('%s', 'now') - 86400,
    strftime('%s', 'now') + 2592000,
    '{}'
  ),
  (
    'ent-demo-paste-pro',
    'tenant-demo',
    'user-demo',
    'sub-demo-paste',
    'paste.pro',
    'plan',
    'granted',
    strftime('%s', 'now') - 86400,
    strftime('%s', 'now') + 2592000,
    '{}'
  );

INSERT INTO subscription_events (
  id,
  tenant_id,
  subscription_id,
  provider,
  event_id,
  event_type,
  occurred_at,
  payload_json,
  status
)
VALUES
  (
    'evt-demo-sub-created',
    'tenant-demo',
    'sub-demo-paste',
    'internal',
    'internal_evt_0001',
    'subscription.created',
    strftime('%s', 'now') - 86400,
    '{"subscription_id":"sub-demo-paste"}',
    'applied'
  );
