-- Cloudflare SSO D1 schema (normalized, multi-tenant)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, -- uuid
  name TEXT NOT NULL,
  domain TEXT UNIQUE, -- optional vanity domain for login
  settings_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- uuid
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
