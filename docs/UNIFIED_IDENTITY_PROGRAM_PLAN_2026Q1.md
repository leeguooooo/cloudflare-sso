# Unified Identity Program Plan (2026 Q1)

Last updated: 2026-02-25
Program owner: platform
Single source of truth: this file

## 1. Program Goal
- Build one identity + subscription platform for all apps:
  - `blog`
  - `paste`
  - `cherry` (mobile + mini-program + admin)
  - future apps
- Ensure each new app can onboard with a standard checklist and no custom auth stack.

## 2. Non-Negotiables
- SSO is the only identity provider in production.
- Entitlement source of truth is centralized billing service (not app-local tables).
- App services only do:
  - token verification
  - principal mapping
  - entitlement check
- No new local session systems are allowed after cutover.

## 3. Timeline (Target)
- Milestone M0: 2026-02-27
  - SSO project skeleton ready (portal + admin + admin API scaffold)
- Milestone M1: 2026-03-06
  - Billing/entitlement schema + base APIs ready
- Milestone M2: 2026-03-13
  - `blog` + `paste` connected to SSO in hybrid mode
- Milestone M3: 2026-03-20
  - `cherry-admin-web` + `cherry-consumer` connected
- Milestone M4: 2026-03-27
  - `cherry-leader` + `cherry-admin-mp` connected
- Milestone M5: 2026-04-03
  - legacy session paths removed, full SSO mode

## 4. Workstreams and Checklist

### W0. Program Control
- [ ] W0-01 Create weekly review ritual (Mon/Wed/Fri) with status update in this file
- [ ] W0-02 Define release gates: `dev -> canary -> prod`
- [ ] W0-03 Define rollback policy for each app
- [ ] W0-04 Define owner for each repo migration PR

Acceptance:
- Every task below has owner + ETA + status at review time.

### W1. SSO Platform (cloudflare-sso)
- [x] W1-01 Add platform entry + portal + admin shell
- [x] W1-02 Add admin overview + clients API scaffold
- [ ] W1-03 Add admin authz middleware for `/api/admin/*` (role/perms required)
- [ ] W1-04 Add client management CRUD UI/API (create/update/disable client)
- [ ] W1-05 Add mini-program login exchange endpoint (`wx.code -> SSO tokens`)
- [ ] W1-06 Add machine-to-machine token flow for backend calls (if needed)
- [ ] W1-07 Add audit logs for auth, client changes, role changes

Acceptance:
- `pnpm lint` passes
- `pnpm build` passes
- Admin endpoints reject non-admin principals

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

### W3. blog Integration
- [ ] W3-01 Register OIDC client: `blog-web`
- [ ] W3-02 Replace local auth session with SSO tokens
- [ ] W3-03 Map existing users to `sso_user_id`
- [ ] W3-04 Replace local membership check with entitlement API
- [ ] W3-05 Remove legacy auth routes after stable period

Acceptance:
- Login/logout/session-refresh pass via SSO
- Premium content gated only by entitlement

### W4. paste Integration
- [ ] W4-01 Register OIDC client: `paste-web`
- [ ] W4-02 Replace local HMAC session flow with SSO token validation
- [ ] W4-03 Disable header identity fallback (`x-user-id/x-device-id`) in production
- [ ] W4-04 Map existing paste users to `sso_user_id`
- [ ] W4-05 Wire plan-to-entitlement checks for paid features

Acceptance:
- No production request succeeds with header-only identity
- Auth path uses SSO only

### W5. cherry Integration (mobile + mini-program + admin)
- [x] W5-01 Write integration plan for cherry
- [ ] W5-02 Add hybrid principal resolver in cherry API (JWT first, KV fallback)
- [ ] W5-03 Register clients:
  - `cherry-consumer`
  - `cherry-leader`
  - `cherry-admin-web`
  - `cherry-admin-mp`
- [ ] W5-04 Cut `admin-web` to OIDC PKCE
- [ ] W5-05 Cut `consumer` mini-program login to SSO exchange
- [ ] W5-06 Cut `leader` login to SSO
- [ ] W5-07 Cut `admin-mp` login to SSO
- [ ] W5-08 Remove `session:user/*`, `session:leader/*`, `session:admin/*` KV dependence

Acceptance:
- All four cherry clients obtain SSO access token
- Legacy KV session endpoints return deprecation response, then removed

### W6. Observability and Safety
- [ ] W6-01 Add auth metrics per app: login success, refresh success, 401 rate
- [ ] W6-02 Add entitlement metrics per app: allowed/denied rates
- [ ] W6-03 Add token verification failure logging with reason labels
- [ ] W6-04 Add incident playbook for auth outage and key rotation

Acceptance:
- Can detect auth regressions in < 10 minutes by dashboard + alert

## 5. Cross-Repo Task Map
- `cloudflare-sso`
  - platform UI/API
  - OIDC/JWKS
  - admin + billing control plane
- `blog`
  - SSO client integration
  - entitlement enforcement
- `paste`
  - session migration + header identity removal
  - entitlement enforcement
- `cherry`
  - multi-client migration (web + mini-program + mobile)
  - hybrid to full SSO cutover

## 6. Weekly Review Template (Do Not Skip)
- Date:
- Completed task IDs:
- New blockers:
- Risk level (low/medium/high):
- Next 7-day focus:
- Decision log:

## 7. Immediate Next 5 Tasks
- [ ] N-01 Implement W1-03 admin authz middleware
- [ ] N-02 Implement W2-01 billing schema migration
- [ ] N-03 Implement W5-02 cherry hybrid principal resolver
- [ ] N-04 Implement W3-01 + W4-01 client registrations
- [ ] N-05 Start W4-03 production guard for header identity fallback
