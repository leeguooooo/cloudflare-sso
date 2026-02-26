# Cloudflare 全栈开源 SSO

Nuxt 4 + Cloudflare Pages + D1/KV/Workers 的单仓 SSO。提供 OAuth2/OIDC Provider（授权码 + PKCE）、RS256 JWT/JWKS、刷新 Token 旋转、登录/注册、会话撤销等基础能力，支持多租户与国际化（EN/简体）。

## 特性
- 单仓全栈：Nuxt SPA + Nitro Functions（Pages Functions）即 Workers 端点
- OIDC: `/.well-known/openid-configuration`、`/authorize`、`/token`、`/userinfo`、`/jwks.json`
- 认证：注册、登录、刷新、登出，Refresh Token 存 D1，Access/ID Token 为 RS256
- 多租户：tenant + client 隔离，客户端重定向白名单
- i18n：内置 EN / 简体，登录/注册页可切换
- 部署：一条命令部署到 Cloudflare Pages，支持多账号 wrangler 切换

## 新增（统一登录简化方案，Phase 1）
- 全局账号模型：`global_accounts` 作为统一凭据源，`users.global_account_id` 做租户映射
- 应用开通接口：`POST /api/admin/apps/bootstrap`（`blog`/`paste`/`cherry`）
- 自动开通租户用户：`POST /api/auth/provision-tenant-user`
- 管理面安全收口：`/api/admin/*` 与 `/api/access/*` 现要求 Bearer Access Token 且需 admin 权限
- Web 双轨：登录仍返回 Bearer Token，并写入 HttpOnly refresh cookie
- Billing 五表已落地：`products`、`plans`、`subscriptions`、`entitlements`、`subscription_events`

## 体验目标（已锁定）
- 统一登录与账户中心的产品目标对标 `https://account.google.com/`
- 第一阶段重点模仿两块体验：`Choose an account` 登录选择页、账号中心导航与信息架构
- 保持 Cloudflare SSO 自有品牌与资产，不复制 Google 品牌素材

## 主要 API（Phase 1）
- `POST /api/auth/register`
  - 入参：`email`, `password`, `client_id`（或 `tenant_id`）
  - 行为：创建 global account，并在目标 tenant 自动开通 user
- `POST /api/auth/login`
  - 入参：`email`, `password`, `client_id`
  - 行为：校验 global account，按 client tenant 自动开通 user，返回 access/id/refresh token
- `POST /api/auth/provision-tenant-user`
  - 入参：`client_id` 或 `tenant_id`
  - 鉴权：Bearer Access Token
  - 行为：将当前用户按 global account 映射开通到目标 tenant（幂等）
- `POST /api/admin/apps/bootstrap`
  - 入参：`app_key`（单个）或 `app_keys`（批量，字符串数组）
  - 鉴权：Bearer Access Token（admin）
  - 行为：创建 tenant、默认 clients、`admin/user` roles 与基础权限绑定
  - 示例：首批可一次传 `["cherry","paste"]`，完成 `cherry-admin-web`、`paste-web`、`paste-macos` 注册
  - 回执：返回 `bootstrap_run_id`，用于后续追踪
- `GET /api/admin/apps/bootstrap-runs`
  - 入参：`run_id`（可选），`limit`（可选，默认 20）
  - 鉴权：Bearer Access Token（admin）
  - 行为：查询 `admin.apps.bootstrap` 审计回执，便于验收追踪
- `GET /api/admin/clients`
  - 入参：`tenant_id`，可选 `include_disabled=true`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：查询租户下 OIDC clients（含启停状态）
- `POST /api/admin/clients`
  - 入参：`tenant_id + action`
  - `action=create|update|disable|enable`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：创建/更新/禁用/启用 client，并写入审计日志
- `POST /api/billing/events/ingest`
  - 入参：`tenant_id`, `provider`, `event_id`, `event_type`，可选 `subscription_id`, `occurred_at`, `payload`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：按 `(tenant_id, provider, event_id)` 幂等入库 `subscription_events`
- `GET /api/billing/catalog`
  - 入参：`tenant_id`，可选 `include_archived=true`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：查询 billing 产品与计划映射（products + plans）
- `POST /api/billing/products`
  - 入参：`tenant_id + action`
  - `action=create|update|archive|unarchive`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：维护产品定义（product_key/app_key/name）
- `POST /api/billing/plans`
  - 入参：`tenant_id + action`
  - `action=create|update|archive|unarchive`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：维护计划定义（price/cycle/trial/entitlement_keys）
- `GET /api/billing/entitlements`
  - 入参：可选 `tenant_id`, `user_id`, `as_of`, `include_inactive=true`
  - 鉴权：Bearer Access Token（同 tenant；跨用户查询需 admin）
  - 行为：返回用户当前有效 entitlement 列表与 `active_entitlement_keys`
- `POST /api/billing/subscriptions/transition`
  - 入参：`tenant_id`, `subscription_id`, `status`，可选 `current_period_start`, `current_period_end`, `cancel_at_period_end`, `canceled_at`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：执行订阅状态迁移，数据库触发器会阻断非法流转

## 快速开始（本地）
```bash
pnpm install
pnpm wrangler:config:test              # 写入 wrangler.toml（确保 D1 database_id 正确）
pnpm dlx wrangler d1 execute DB --file=./schema.sql --remote   # 初始化表（或本地 wrangler d1）
pnpm dlx wrangler d1 execute DB --file=./test-data.sql --remote # 导入示例账号
pnpm dev
```

示例账号：`demo@example.com` / 密码：`Passw0rd!`，租户 `tenant-demo`，客户端 `demo-web`。

## 部署到 Cloudflare Pages
- 测试：`pnpm deploy:test`
- 生产：`pnpm deploy:prod`
- 日志：`pnpm logs:test` / `pnpm logs:prod`

## 环境变量（wrangler.account-*.toml）
- `DB`：D1 binding（保持现有配置）
- `JWT_PRIVATE_KEY`：RS256 PKCS8 私钥（多行字符串）
- `JWT_KID`：JWKS kid，默认 `primary`
- `JWT_ISSUER`：`https://your-domain`（用于 `iss` 与发现文档）
- `PASSWORD_PEPPER`：额外的密码 pepper
- `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS`：Token 时长

更多细节见 `docs/DEPLOY.md` 与 `docs/WRANGLER_CONFIG.md`。
