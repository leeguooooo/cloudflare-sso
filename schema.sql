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
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
  password_set INTEGER, -- 0 when the password is a random placeholder (social-only account)
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_accounts_email_unique ON global_accounts(normalized_email);

CREATE TABLE IF NOT EXISTS global_external_identities (
  id TEXT PRIMARY KEY, -- uuid
  global_account_id TEXT NOT NULL REFERENCES global_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- github/google/wechat
  subject TEXT NOT NULL, -- provider subject/user id
  email TEXT,
  profile_json TEXT DEFAULT '{}' NOT NULL,
  email_verified INTEGER, -- provider vouches for `email`
  is_private_email INTEGER, -- Apple private relay address
  email_disabled INTEGER, -- Apple: relay forwarding turned off
  refresh_token TEXT, -- provider refresh token (Apple: needed to revoke on deletion)
  refresh_token_client_id TEXT, -- Apple client the refresh token belongs to (NULL = Services ID)
  consent_revoked_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_external_identities_unique ON global_external_identities(provider, subject);
CREATE INDEX IF NOT EXISTS idx_global_external_identities_account ON global_external_identities(global_account_id);

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
  auth_time INTEGER, -- when the user signed in for the session that approved this code
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
  auth_time INTEGER, -- when the user actually authenticated (kept across refreshes)
  scope TEXT, -- scope granted at sign-in, preserved on refresh
  previous_refresh_token_hash TEXT, -- for refresh token replay detection
  rotated_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_prev_token ON sessions (previous_refresh_token_hash);

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
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id, created_at DESC);
-- Admin actions on an account (logged under the admin's user id); partial, so other rows cost nothing.
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs (json_extract(payload_json, '$.target_global_account_id'))
  WHERE json_extract(payload_json, '$.target_global_account_id') IS NOT NULL;

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

-- Server-side OAuth state for social sign-in (the cookie only carries the random state)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

-- Account merge proposals and their progress (retryable, idempotent)
CREATE TABLE IF NOT EXISTS account_merges (
  id TEXT PRIMARY KEY,
  from_global_account_id TEXT NOT NULL,
  to_global_account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  error TEXT,
  detail_json TEXT DEFAULT '{}' NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_merges_to ON account_merges(to_global_account_id, status);

-- Failed password sign-ins, for throttling (pruned opportunistically)
CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures_email ON login_failures (email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures (ip, created_at);

-- OAuth 2.0 device authorization grant (RFC 8628); device_code stored as a SHA-256 hash
CREATE TABLE IF NOT EXISTS device_codes (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE, -- 8 letters, stored without the dash
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  global_account_id TEXT, -- who approved
  auth_time INTEGER,
  poll_interval INTEGER NOT NULL DEFAULT 5,
  last_polled_ms INTEGER,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes (expires_at);

-- First-use trials (TENANT_SIGNUP_TRIALS): one row per account and tenant, ever
-- Two-step verification (TOTP + recovery codes) for email + password sign-in, per global account
CREATE TABLE IF NOT EXISTS account_mfa (
  global_account_id TEXT PRIMARY KEY REFERENCES global_accounts(id) ON DELETE CASCADE,
  key_source TEXT NOT NULL, -- which server secret seals totp_secret: mfa_key | pepper_v2 | pepper
  totp_secret TEXT, -- AES-GCM sealed; NULL until enrolment is confirmed
  pending_secret TEXT,
  pending_created_at INTEGER,
  recovery_codes_json TEXT DEFAULT '[]' NOT NULL, -- [{ hash, used_at }]
  last_step INTEGER DEFAULT -1 NOT NULL, -- last accepted TOTP step (no replay)
  enabled_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Daily allow/deny counts of GET /api/billing/entitlements/check, per app and key (admin metrics)
CREATE TABLE IF NOT EXISTS entitlement_check_daily (
  day TEXT NOT NULL, -- UTC yyyy-mm-dd
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, client_id, entitlement_key, result)
) WITHOUT ROWID;

-- Legacy app user -> SSO account mappings (migrating an app's existing users), reversible
CREATE TABLE IF NOT EXISTS identity_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_system TEXT NOT NULL, -- e.g. paste / blog / cherry
  source_user_id TEXT NOT NULL,
  global_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- the tenant user: the app's `sub` from now on
  outcome TEXT NOT NULL CHECK (outcome IN ('linked', 'created', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  run_id TEXT,
  mapped_by TEXT NOT NULL,
  mapped_at INTEGER NOT NULL,
  reverted_by TEXT,
  reverted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_mappings_active
  ON identity_mappings (tenant_id, source_system, source_user_id) WHERE status = 'active';

-- Daily pre-SSO auth usage reported by apps (POST /api/metrics/legacy-auth), for fallback sunset decisions
CREATE TABLE IF NOT EXISTS legacy_auth_daily (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL, -- UTC yyyy-mm-dd
  client_id TEXT NOT NULL,
  path TEXT NOT NULL, -- e.g. header-identity / kv-session
  legacy_hits INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, client_id, path)
) WITHOUT ROWID;

-- Event webhooks per tenant (admin console /admin/webhooks) and their delivery log
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL, -- '*' or space-separated event types
  secret_sealed TEXT NOT NULL, -- AES-GCM sealed signing secret
  key_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  description TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints (tenant_id);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  last_error TEXT,
  next_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- Passkeys (WebAuthn) per global account, and one-time ceremony challenges
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, -- credential id (base64url)
  global_account_id TEXT NOT NULL REFERENCES global_accounts(id) ON DELETE CASCADE,
  public_key_json TEXT NOT NULL, -- { alg, jwk }
  sign_count INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  transports TEXT,
  backed_up INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_account ON passkeys (global_account_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  global_account_id TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Per-account settings (today: new-device sign-in alert emails, on by default)
CREATE TABLE IF NOT EXISTS account_preferences (
  global_account_id TEXT PRIMARY KEY REFERENCES global_accounts(id) ON DELETE CASCADE,
  sign_in_alerts INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_grants (
  global_account_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  entitlement_id TEXT NOT NULL, -- the entitlements row this grant wrote (source 'promo', meta_json.trial = true)
  user_id TEXT,
  granted_at INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  PRIMARY KEY (global_account_id, tenant_id)
);

-- 爱发电 (afdian) memberships: checkouts started on /membership, afdian user ↔ account bindings,
-- and every order afdian reported (applied at most once, keyed by out_trade_no)
CREATE TABLE IF NOT EXISTS afdian_checkouts (
  id TEXT PRIMARY KEY, -- sent to afdian as custom_order_id
  global_account_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  month INTEGER NOT NULL,
  consumed_order TEXT, -- first out_trade_no that came back with this id
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS afdian_bindings (
  afdian_user_id TEXT PRIMARY KEY,
  global_account_id TEXT NOT NULL,
  bound_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afdian_bindings_account ON afdian_bindings (global_account_id);

CREATE TABLE IF NOT EXISTS afdian_orders (
  out_trade_no TEXT PRIMARY KEY,
  plan_id TEXT,
  afdian_user_id TEXT,
  custom_order_id TEXT,
  month INTEGER,
  total_amount TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'matched', 'unmatched', 'rejected', 'error')),
  reason TEXT,
  global_account_id TEXT,
  tenant_id TEXT,
  user_id TEXT,
  entitlement_id TEXT,
  valid_to INTEGER,
  via TEXT, -- webhook / reconcile / admin
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_status ON afdian_orders (status, created_at DESC);
