-- Cloudflare SSO D1 schema (normalized, multi-tenant)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, -- uuid
  name TEXT NOT NULL,
  domain TEXT UNIQUE, -- optional vanity domain for login
  settings_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS global_accounts (
  id TEXT PRIMARY KEY, -- uuid
  email TEXT NOT NULL,
  normalized_email TEXT GENERATED ALWAYS AS (lower(email)) VIRTUAL,
  password_hash TEXT NOT NULL,
  locale TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_accounts_email_unique ON global_accounts(normalized_email);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  global_account_id TEXT REFERENCES global_accounts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  normalized_email TEXT GENERATED ALWAYS AS (lower(email)) VIRTUAL,
  password_hash TEXT, -- null when only external IdP
  locale TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
  mfa_enforced INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (tenant_id, normalized_email);
CREATE INDEX IF NOT EXISTS idx_users_global_account ON users(global_account_id);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY, -- uuid
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('password', 'totp', 'webauthn', 'recovery', 'external')),
  secret TEXT NOT NULL, -- hashed password / encoded secret / external subject
  meta_json TEXT DEFAULT '{}' NOT NULL, -- e.g. webauthn key info
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_user_type ON credentials (user_id, type);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE, -- public identifier
  client_secret TEXT, -- nullable for public clients
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array
  grant_types TEXT NOT NULL DEFAULT 'authorization_code pkce',
  scope TEXT NOT NULL DEFAULT 'openid profile email',
  first_party INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  updated_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients (tenant_id);

CREATE TABLE IF NOT EXISTS auth_codes (
  id TEXT PRIMARY KEY, -- uuid
  code TEXT NOT NULL UNIQUE, -- one-time authorization code (random string)
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  nonce TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT DEFAULT 'S256',
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (refresh_token_hash);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY, -- uuid
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'magic_login')),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose ON email_tokens (user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_email_tokens_token_hash ON email_tokens (token_hash);

-- RBAC tables
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  built_in INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_unique ON roles (tenant_id, name);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_unique ON permissions (tenant_id, action, resource);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Which roles apply to which client (application)
CREATE TABLE IF NOT EXISTS client_roles (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, role_id)
);

-- User-role assignment (optionally scoped to a client)
CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY, -- uuid
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique ON user_roles (user_id, role_id, COALESCE(client_id, ''));

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  payload_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_action ON audit_logs (tenant_id, action, created_at DESC);

-- Billing / entitlement control-plane tables
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  name TEXT NOT NULL,
  app_key TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  meta_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_key_unique ON products (tenant_id, product_key);
CREATE INDEX IF NOT EXISTS idx_products_tenant_app ON products (tenant_id, app_key, status);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  name TEXT NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly', 'one_time', 'custom')),
  currency TEXT DEFAULT 'USD' NOT NULL,
  amount_minor INTEGER DEFAULT 0 NOT NULL CHECK (amount_minor >= 0),
  trial_days INTEGER DEFAULT 0 NOT NULL CHECK (trial_days >= 0),
  entitlement_keys_json TEXT DEFAULT '[]' NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  meta_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_key_unique ON plans (tenant_id, plan_key);
CREATE INDEX IF NOT EXISTS idx_plans_product_status ON plans (product_id, status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  provider TEXT DEFAULT 'internal' NOT NULL CHECK (provider IN ('internal', 'stripe', 'manual', 'system')),
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  started_at INTEGER NOT NULL,
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0 NOT NULL CHECK (cancel_at_period_end IN (0, 1)),
  canceled_at INTEGER,
  meta_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_ref_unique
  ON subscriptions (tenant_id, provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (tenant_id, user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_status ON subscriptions (plan_id, status);

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_status_transition_guard
BEFORE UPDATE OF status ON subscriptions
FOR EACH ROW
WHEN OLD.status <> NEW.status
BEGIN
  SELECT CASE
    WHEN OLD.status = 'trialing' AND NEW.status IN ('active', 'past_due', 'canceled', 'expired') THEN 1
    WHEN OLD.status = 'active' AND NEW.status IN ('past_due', 'canceled', 'expired') THEN 1
    WHEN OLD.status = 'past_due' AND NEW.status IN ('active', 'canceled', 'expired') THEN 1
    ELSE RAISE(ABORT, 'invalid subscription status transition')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_canceled_at_required_on_insert
BEFORE INSERT ON subscriptions
FOR EACH ROW
WHEN NEW.status = 'canceled' AND NEW.canceled_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'canceled_at required when status is canceled');
END;

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_canceled_at_required_on_update
BEFORE UPDATE ON subscriptions
FOR EACH ROW
WHEN NEW.status = 'canceled' AND NEW.canceled_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'canceled_at required when status is canceled');
END;

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  entitlement_key TEXT NOT NULL,
  source TEXT DEFAULT 'plan' NOT NULL CHECK (source IN ('plan', 'manual', 'promo', 'system')),
  status TEXT DEFAULT 'granted' NOT NULL CHECK (status IN ('granted', 'revoked')),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  revoked_at INTEGER,
  meta_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_dedupe
  ON entitlements (tenant_id, user_id, entitlement_key, COALESCE(subscription_id, ''), source, valid_from);
CREATE INDEX IF NOT EXISTS idx_entitlements_lookup
  ON entitlements (tenant_id, user_id, entitlement_key, status, valid_from DESC);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('internal', 'stripe', 'manual', 'system')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload_json TEXT DEFAULT '{}' NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'applied', 'ignored', 'failed')),
  error_message TEXT,
  processed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_events_provider_event_unique
  ON subscription_events (tenant_id, provider, event_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_status
  ON subscription_events (tenant_id, status, occurred_at DESC);
