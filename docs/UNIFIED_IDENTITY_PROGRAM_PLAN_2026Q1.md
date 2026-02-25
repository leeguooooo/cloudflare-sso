# Unified Identity Program Plan (2026 Q1)

Last updated: 2026-02-25
Program owner: platform
Single source of truth: this file

## 0. Cross-Repo Current State Baseline (Confirmed)
- `cloudflare-sso`
  - OIDC core endpoints are present (`/authorize`, `/token`, `/jwks.json`, `/.well-known/openid-configuration`).
  - `api/admin/*` and `api/access/*` still need mandatory authz guard (current routes are query/body driven).
  - `wx.code -> token` exchange endpoint is not ready yet.
- `blog`
  - Full local identity stack exists (`users`, `identities`, `sessions`) plus local `memberships` tables and flows.
  - Web pages call local `/api/auth/*` directly.
- `paste`
  - Uses local signed session tokens and still supports header identity fallback (`x-user-id`, `x-device-id`).
  - `apps/macos` can work with bearer token or legacy header identity.
- `cherry`
  - API is KV-session based (`session:user/*`, `session:leader/*`, `session:admin/*`).
  - A dedicated migration plan already exists in `cherry/docs/SSO_INTEGRATION_PLAN.md`.

Program implication:
- Legacy identity paths cannot be removed until all active clients (including desktop and mini-program) are migrated and fallback hit rate is near zero.

## 1. Program Goal
- Build one identity + subscription platform for all apps:
  - `blog`
  - `paste` (web + macOS)
  - `cherry` (mobile + mini-program + admin)
  - future apps
- Ensure each new app can onboard with a standard checklist and no custom auth stack.

## 2. Architecture Principles (Google-Inspired, First-Party Scope)
- Standards first:
  - OAuth 2.0 + OIDC only; no proprietary auth protocol for new apps.
- Client isolation:
  - Independent `client_id` per app surface (`web`, `desktop`, `mini-program`, backend jobs).
- Token safety:
  - Short-lived access token + rotating refresh token.
  - JWKS key rotation with overlapping valid keys during rollout window.
- Least privilege:
  - Scope and audience per client/app API.
- Progressive cutover:
  - Hybrid mode allowed only with explicit sunset gates and metric-based exit criteria.

Notes:
- We can and should reference Google's mature model as a benchmark for flow design and safety controls.
- We should not copy Google-specific product behavior that does not fit first-party internal SSO.

## 3. Non-Negotiables
- SSO is the only identity provider in production after cutover.
- Entitlement source of truth is centralized billing service (not app-local tables).
- App services only do:
  - token verification
  - principal mapping
  - entitlement check
- No new local session systems are allowed after cutover.
- Any fallback path (`header identity`, `KV session`, legacy cookie session) must have:
  - owner
  - sunset date
  - cut criteria (`fallback requests < 0.1%` for 7 consecutive days)

## 4. Timeline (Target, Dependency-Aware)
- Milestone M0: 2026-02-27
  - SSO security prerequisites ready:
    - authz middleware for `api/admin/*` and `api/access/*`
    - audit logs for admin/access mutations
- Milestone M1: 2026-03-06
  - Billing/entitlement schema + read APIs + event ingestion ready
  - Identity mapping rules (cross-repo canonical principal spec) finalized
- Milestone M2: 2026-03-13
  - `cherry-admin-web` + `cherry-consumer` connected in hybrid mode
- Milestone M3: 2026-03-20
  - `cherry-leader` + `cherry-admin-mp` connected
  - Cherry KV session fallback traffic < 10%
- Milestone M4: 2026-03-27
  - `paste-web` + `paste-macos` connected
  - Header identity fallback default-off in canary
- Milestone M5: 2026-04-03
  - `blog` connected in hybrid mode
  - Local membership checks replaced by entitlement API
- Milestone M6: 2026-04-10
  - Legacy session/header/KV paths removed, full SSO mode

## 5. Workstreams and Checklist

Task metadata format:
- Each task must include `owner`, `eta`, `status` in weekly review updates.

### W0. Program Control
- [ ] W0-01 Create weekly review ritual (Mon/Wed/Fri) with status update in this file
- [ ] W0-02 Define release gates: `dev -> canary -> prod`
- [ ] W0-03 Define rollback policy for each app/client
- [ ] W0-04 Define owner for each repo migration PR
- [ ] W0-05 Track fallback hit rates per app/client in every review

Acceptance:
- Every task has owner + ETA + status.
- Every fallback path has sunset date + measured hit rate.

### W1. SSO Platform (cloudflare-sso)
- [x] W1-01 Add platform entry + portal + admin shell
- [x] W1-02 Add admin overview + clients API scaffold
- [ ] W1-03 Add mandatory authz middleware for `/api/admin/*` and `/api/access/*` (role/perms required)
- [ ] W1-04 Add client management CRUD UI/API (create/update/disable client)
- [ ] W1-05 Add mini-program login exchange endpoint (`wx.code -> SSO tokens`)
- [ ] W1-06 Add machine-to-machine token flow for backend calls (if needed)
- [ ] W1-07 Add audit logs for auth, client changes, role changes
- [ ] W1-08 Add interactive OIDC login/authorize flow for browser PKCE clients

Acceptance:
- `pnpm lint` passes
- `pnpm build` passes
- Non-admin principals are rejected by admin/access APIs
- Browser PKCE client can complete code flow end-to-end

### W2. Billing and Entitlement Control Plane
- [ ] W2-01 Create schema: `products`, `plans`, `subscriptions`, `entitlements`, `subscription_events`
- [ ] W2-02 Add idempotent event ingestion endpoint (Stripe/manual/system)
- [ ] W2-03 Add entitlement read API for apps
- [ ] W2-04 Add admin billing UI for product/plan mapping
- [ ] W2-05 Add transition guards for subscription state machine
- [ ] W2-06 Add reconciliation job and mismatch alerting

Acceptance:
- Event replay is idempotent
- Invalid state transitions are blocked at DB layer
- Entitlement query is deterministic for a user at time T

### W3. Identity Mapping and Migration Safety (Cross-Repo)
- [ ] W3-01 Define canonical principal fields (`iss`, `sub`, `tenant`, `app`, `roles`)
- [ ] W3-02 Define user linking policy per repo (`blog`, `paste`, `cherry`) with conflict rules
- [ ] W3-03 Add idempotent mapping migration scripts + dry-run report
- [ ] W3-04 Add rollback scripts for wrong user linking
- [ ] W3-05 Add migration audit table (`source_user_id`, `sso_user_id`, `mapped_at`, `mapped_by`)

Acceptance:
- Mapping can be replayed safely (idempotent)
- Conflict cases are deterministic and auditable

### W4. cherry Integration (mobile + mini-program + admin)
- [x] W4-01 Write integration plan for cherry
- [ ] W4-02 Add hybrid principal resolver in cherry API (JWT first, KV fallback)
- [ ] W4-03 Register clients:
  - `cherry-consumer`
  - `cherry-leader`
  - `cherry-admin-web`
  - `cherry-admin-mp`
- [ ] W4-04 Cut `admin-web` to OIDC PKCE
- [ ] W4-05 Cut `consumer` mini-program login to SSO exchange
- [ ] W4-06 Cut `leader` login to SSO
- [ ] W4-07 Cut `admin-mp` login to SSO
- [ ] W4-08 Remove `session:user/*`, `session:leader/*`, `session:admin/*` KV dependence

Acceptance:
- All four cherry clients obtain SSO access token
- Legacy KV session endpoints return deprecation response, then removed

### W5. paste Integration (web + macOS)
- [ ] W5-01 Register OIDC clients: `paste-web`, `paste-macos`
- [ ] W5-02 Replace local HMAC session flow with SSO token validation
- [ ] W5-03 Replace macOS token/header compatibility path with SSO-only principal
- [ ] W5-04 Disable header identity fallback (`x-user-id/x-device-id`) in production
- [ ] W5-05 Map existing paste users to `sso_user_id`
- [ ] W5-06 Wire plan-to-entitlement checks for paid features

Acceptance:
- No production request succeeds with header-only identity
- Web and macOS auth paths use SSO only

### W6. blog Integration
- [ ] W6-01 Register OIDC client: `blog-web`
- [ ] W6-02 Replace local auth session with SSO tokens
- [ ] W6-03 Map existing users to `sso_user_id`
- [ ] W6-04 Replace local membership check with entitlement API
- [ ] W6-05 Remove legacy auth routes after stable period

Acceptance:
- Login/logout/session-refresh pass via SSO
- Premium content gated only by entitlement

### W7. Observability and Safety
- [ ] W7-01 Add auth metrics per app/client: login success, refresh success, 401 rate
- [ ] W7-02 Add entitlement metrics per app/client: allowed/denied rates
- [ ] W7-03 Add token verification failure logging with reason labels
- [ ] W7-04 Add incident playbook for auth outage and key rotation
- [ ] W7-05 Add fallback usage dashboard and alert (`legacy path hit rate > threshold`)

Acceptance:
- Can detect auth regressions in < 10 minutes by dashboard + alert
- Can prove fallback trend is converging to zero before removal

## 6. Cross-Repo Task Map
- `cloudflare-sso`
  - OIDC/JWKS/token lifecycle
  - admin/access guard + audit
  - billing + entitlement control plane
- `blog`
  - local auth replacement
  - membership -> entitlement migration
- `paste`
  - web + macOS principal migration
  - header identity removal
  - entitlement enforcement
- `cherry`
  - multi-client migration (web + mini-program + mobile)
  - KV session removal
  - hybrid to full SSO cutover

## 7. Weekly Review Template (Do Not Skip)
- Date:
- Completed task IDs:
- Task owner/ETA/status updates:
- New blockers:
- Risk level (low/medium/high):
- Fallback hit rate by app/client:
- Next 7-day focus:
- Decision log:

## 8. Immediate Next 5 Tasks
- [ ] N-01 Implement W1-03 admin/access authz middleware
- [ ] N-02 Implement W1-08 browser PKCE authorize/login end-to-end path
- [ ] N-03 Implement W2-01 billing schema migration
- [ ] N-04 Implement W4-02 cherry hybrid principal resolver
- [ ] N-05 Register first batch clients: `cherry-admin-web`, `paste-web`, `paste-macos`
