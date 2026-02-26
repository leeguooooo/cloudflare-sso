import { H3Event } from 'h3'
import { getDb } from './env'

export const ensureBillingSchema = async (event: H3Event) => {
  const db = getDb(event)

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        product_key TEXT NOT NULL,
        name TEXT NOT NULL,
        app_key TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        meta_json TEXT DEFAULT '{}' NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
      )`,
    )
    .run()
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_key_unique ON products (tenant_id, product_key)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_tenant_app ON products (tenant_id, app_key, status)`).run()

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
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
      )`,
    )
    .run()
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_key_unique ON plans (tenant_id, plan_key)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_plans_product_status ON plans (product_id, status)`).run()

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
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
      )`,
    )
    .run()
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_ref_unique
       ON subscriptions (tenant_id, provider, provider_ref)
       WHERE provider_ref IS NOT NULL`,
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (tenant_id, user_id, status, updated_at DESC)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_status ON subscriptions (plan_id, status)`).run()

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
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
      )`,
    )
    .run()
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_dedupe
       ON entitlements (tenant_id, user_id, entitlement_key, COALESCE(subscription_id, ''), source, valid_from)`,
    )
    .run()
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_entitlements_lookup
       ON entitlements (tenant_id, user_id, entitlement_key, status, valid_from DESC)`,
    )
    .run()

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS subscription_events (
        id TEXT PRIMARY KEY,
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
      )`,
    )
    .run()
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_events_provider_event_unique
       ON subscription_events (tenant_id, provider, event_id)`,
    )
    .run()
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_subscription_events_status
       ON subscription_events (tenant_id, status, occurred_at DESC)`,
    )
    .run()

  // DB-level state machine guard
  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS trg_subscriptions_status_transition_guard
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
       END`,
    )
    .run()

  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS trg_subscriptions_canceled_at_required_on_insert
       BEFORE INSERT ON subscriptions
       FOR EACH ROW
       WHEN NEW.status = 'canceled' AND NEW.canceled_at IS NULL
       BEGIN
         SELECT RAISE(ABORT, 'canceled_at required when status is canceled');
       END`,
    )
    .run()

  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS trg_subscriptions_canceled_at_required_on_update
       BEFORE UPDATE ON subscriptions
       FOR EACH ROW
       WHEN NEW.status = 'canceled' AND NEW.canceled_at IS NULL
       BEGIN
         SELECT RAISE(ABORT, 'canceled_at required when status is canceled');
       END`,
    )
    .run()
}
