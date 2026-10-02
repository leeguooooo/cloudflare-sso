# Cloudflare 全栈开源 SSO

Nuxt 4 + Cloudflare Pages + D1/KV/Workers 的单仓 SSO。提供 OAuth2/OIDC Provider（授权码 + PKCE）、RS256 JWT/JWKS、刷新 Token 旋转、登录/注册、会话撤销等基础能力，支持多租户与国际化（EN/简体）。

## 特性
- 单仓全栈：Nuxt SPA + Nitro Functions（Pages Functions）即 Workers 端点
- OIDC: `/.well-known/openid-configuration`、`/authorize`、`/token`、`/userinfo`、`/jwks.json`、`/revoke`（RFC 7009）、`/logout`（RP-Initiated Logout）
- 认证：注册、登录、刷新、登出，Refresh Token 存 D1（轮换 + 重放检测），Access/ID Token 为 RS256；登录失败限流
- 服务间调用：`client_credentials`（机密 client + 业务 scope，例如 `billing:events.write`）
- 第三方登录：通过 Apple 登录 / GitHub / Google OAuth（WeChat 记为 TODO），一个账号可绑定多种登录方式，重复账号可合并
- 多租户：tenant + client 隔离，客户端重定向白名单
- i18n：内置 EN / 简体，登录/注册页可切换
- 部署：一条命令部署到 Cloudflare Pages，支持多账号 wrangler 切换

## 需要配置才会启用的功能
| 功能 | 需要的配置 | 未配置时 |
| --- | --- | --- |
| 找回密码、邮箱验证、更换邮箱 | secret `RESEND_API_KEY` + 变量 `EMAIL_FROM`（本地可用 `EMAIL_TRANSPORT=log`）。**生产已启用**：Resend key「cloudflare-sso」仅发信权限、仅限 misonote.com，发件人 `no-reply@misonote.com` | 入口隐藏，接口返回 503 |
| 微信扫码登录 | `WECHAT_WEB_APP_ID` + secret `WECHAT_WEB_APP_SECRET`（微信开放平台网站应用） | 按钮隐藏 |
| 微信小程序登录 | `WECHAT_MINIPROGRAMS='{"<client_id>":{"appid":"wx…"}}'` + secret `WECHAT_MP_SECRET_<APPID>` | 接口返回 400 |
| 密码 pepper 迁移 | secret `PASSWORD_PEPPER_V2`（**生产已启用**，2026-10-02；备份在 Bitwarden `backup` 文件夹「cloudflare-sso PASSWORD_PEPPER_V2」） | 新密码继续用旧 pepper |
| 账单对账定时任务 | Pages secret `RECONCILE_SECRET` + 部署 `workers/billing-reconcile`（**生产已启用**，每 30 分钟） | 不对账 |

## 新增（统一登录简化方案，Phase 1）
- 全局账号模型：`global_accounts` 作为统一凭据源，`users.global_account_id` 做租户映射
- 应用开通接口：`POST /api/admin/apps/bootstrap`（`blog`/`paste`/`misonote`/`cherry`）
- 自动开通租户用户：`POST /api/auth/provision-tenant-user`
- 管理面安全收口：`/api/admin/*`、`/api/access/*`、billing 管理接口要求 Bearer Access Token、admin 权限，且 token 必须签发给账号中心 client（`DEFAULT_CLIENT_ID` 或 `ADMIN_CLIENT_IDS`）
- Web 双轨：登录仍返回 Bearer Token，并写入 HttpOnly refresh cookie
- Billing 五表已落地：`products`、`plans`、`subscriptions`、`entitlements`、`subscription_events`

## 体验目标（已锁定）
- 统一登录与账户中心的产品目标对标 `https://account.google.com/`
- 第一阶段重点模仿两块体验：`Choose an account` 登录选择页、账号中心导航与信息架构
- 保持 Cloudflare SSO 自有品牌与资产，不复制 Google 品牌素材

## OIDC 约定（接入方必读）
- **PKCE 必填**：public client（没有 secret 的 client，目前全部）在 `/authorize` 必须带 `code_challenge`（仅 S256），否则带 `error=invalid_request` 回跳。
- `/authorize` 只认账号域名下的会话 cookie，**不接受 `Authorization: Bearer`**。
- `prompt=none` 未登录时按规范回跳 `redirect_uri?error=login_required&state=…`；支持 `prompt=login` 与 `max_age`。
- ID Token 带 `nonce`（若请求带了）与 `auth_time`；`/userinfo` 返回标准 `picture`（`avatar_url` 保留为别名），`email_verified` 为真实值（只有第三方登录确认过账号邮箱才为 true）。
- `/token` 错误为 OAuth 标准格式 `{ error, error_description }`。
- Refresh token 每次刷新都会轮换；旧 token 在轮换 30 秒后再被使用视为重放，整个会话会被吊销。会话绝对寿命 `SESSION_MAX_AGE_SECONDS`（默认一年）。
- 注销：`GET /logout?id_token_hint=…&post_logout_redirect_uri=…&state=…`，回跳地址必须与该 client 某个已注册 `redirect_uri` 同源；或者 `POST /revoke` 吊销 refresh/access token。
- `/userinfo` 会检查会话是否仍有效：用户登出或会话被吊销后，用 `/userinfo` 校验的应用立刻感知。
- 签名 key 用 `kid` 区分，验签方请按 `kid` 从 `/jwks.json` 取 key，并在遇到未知 `kid` 时重新拉取 JWKS。

## 账号与登录接口（补充）
- `POST /api/auth/password/forgot { email, client_id? }`：发送 30 分钟有效的重置链接；不论邮箱是否存在都返回 `{ ok: true }`；按 IP 与邮箱限流
- `POST /api/auth/password/reset { token, password }`：一次性令牌；成功后吊销该账号所有会话，并视为邮箱已验证
- `POST /api/account/email/verify`：给当前邮箱发验证链接；`POST /api/account/email/change { new_email }`：需近期登录，向新邮箱发确认链接，点开后才生效
- `GET /api/auth/email/verify?token=`：邮件链接落地，回跳账号中心
- `GET /api/account/export`：下载账号数据（资料、登录方式、会话、完整活动记录、订阅与权益）
- `POST /api/auth/wechat/miniprogram { client_id, code }`：`wx.login()` 的 code 换 SSO token（同 `/token` 响应）。有 unionid 时网站与各小程序落到同一个账号
- 管理：`GET/POST /api/admin/users`（禁用/启用/全部登出）、`GET /api/admin/metrics`（登录健康度）、`GET /api/billing/subscriptions`、`GET /api/billing/events`
- 内部：`POST /api/internal/billing/reconcile`（`RECONCILE_SECRET`，由 `workers/billing-reconcile` 每 30 分钟调用；可配 `ALERT_WEBHOOK_URL` 推送告警到飞书/Discord/Slack）

## 服务间调用（client_credentials）
1. 在管理后台（或 `POST /api/admin/clients`）创建 client：`grant_types: "client_credentials"`、`scope: "billing:events.write billing:entitlements.read"`、`generate_secret: true`。响应里的 `client_secret` **只出现这一次**，库里只存哈希。
2. 换 token：`POST /token`，HTTP Basic `client_id:client_secret`，`grant_type=client_credentials`。
3. 得到的 access token：`sub = client:<client_id>`、`client_only: true`，只能调用声明了对应 scope 的接口；不能调用用户/管理接口。

## 主要 API（Phase 1）
- `POST /api/auth/register`
  - 入参：`email`, `password`，可选 `client_id`（或 `tenant_id`）
  - 行为：创建 global account，并在目标 tenant 自动开通 user
- `POST /api/auth/login`
  - 入参：`email`, `password`，可选 `client_id`
  - 行为：校验 global account，按 client tenant 自动开通 user，返回 access/id/refresh token
- `POST /api/auth/provision-tenant-user`
  - 入参：`client_id` 或 `tenant_id`
  - 鉴权：Bearer Access Token
  - 行为：将当前用户按 global account 映射开通到目标 tenant（幂等）
- `POST /api/admin/apps/bootstrap`
  - 入参：`app_key`（单个）或 `app_keys`（批量，字符串数组）
  - 鉴权：Bearer Access Token，**平台管理员**（`DEFAULT_CLIENT_ID` 所在租户、或 `PLATFORM_TENANT_ID` 的 admin）
  - 行为：创建 tenant、默认 clients、`admin/user` roles 与基础权限绑定
  - 示例：可一次传 `["misonote","paste"]`，完成 `misonote-app-web`、`misonote-paste-web`、`misonote-paste-macos`、`paste-web`、`paste-macos` 注册
  - 回执：返回 `bootstrap_run_id`，用于后续追踪
- `GET /api/admin/apps/bootstrap-runs`
  - 入参：`run_id`（可选），`limit`（可选，默认 20）
  - 鉴权：Bearer Access Token（admin）
  - 行为：查询 `admin.apps.bootstrap` 审计回执，便于验收追踪

Paste 客户端约定（统一账号）：
- Web：`misonote-paste-web`
  - `redirect_uri` 白名单包含：
    - `https://paste-web.misonote.com/`
    - `https://paste-web.misonote.com/auth/callback`
    - `https://paste.misonote.com/`
    - `https://paste.misonote.com/auth/callback`
- macOS：`misonote-paste-macos`
  - `redirect_uri` 白名单包含：`http://127.0.0.1:45897/auth/sso/callback`
- 不建议 Web 与 Desktop 复用同一个 `client_id`。
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
  - 鉴权：Bearer Access Token（tenant admin），或带 `billing:events.write` 的 service token
  - 行为：按 `(tenant_id, provider, event_id)` 幂等入库并**立即处理**，生成/更新订阅与权益；事件状态 `applied` / `ignored` / `failed`（`error_message` 说明原因）。重复投递会重试 `pending`/`failed` 的事件。
  - 事件类型（详见 `server/utils/billing-events.ts`）：
    - `subscription.activated` / `subscription.renewed` / `subscription.updated`：`payload: { plan_key, user_id | global_account_id, provider_ref?, status?, current_period_start?, current_period_end?, cancel_at_period_end? }`，不存在则创建订阅，并按 plan 的 `entitlement_keys` 发放权益到 `current_period_end`（没有则永久）
    - `subscription.past_due`：保留权益到周期结束
    - `subscription.canceled`：`cancel_at_period_end: true` 时权益保留到周期结束，否则立即结束
    - `subscription.expired`
    - `entitlement.granted` / `entitlement.revoked`：`payload: { user_id | global_account_id, entitlement_key, valid_to? }` 手动发放/收回
    - 比该订阅最近一次已处理事件更早的事件会被忽略（防乱序回滚）
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
  - 推荐：统一会员计划至少包含 `membership.all_apps`
- `GET /api/billing/entitlements`
  - 入参：可选 `tenant_id`, `user_id`, `as_of`, `include_inactive=true`
  - 鉴权：Bearer Access Token（同 tenant；跨用户查询需 admin），或带 `billing:entitlements.read` 的 service token（必须传 `user_id`）
  - 行为：返回用户当前有效 entitlement 列表与 `active_entitlement_keys`
- `POST /api/billing/subscriptions/transition`
  - 入参：`tenant_id`, `subscription_id`, `status`，可选 `current_period_start`, `current_period_end`, `cancel_at_period_end`, `canceled_at`
  - 鉴权：Bearer Access Token（tenant admin）
  - 行为：执行订阅状态迁移，数据库触发器会阻断非法流转

## 快速开始（本地）
```bash
pnpm install
pnpm wrangler:config:prod              # 写入 wrangler.toml（确保 D1 database_id 正确）
pnpm dlx wrangler d1 execute DB --file=./schema.sql --remote   # 初始化表（或本地 wrangler d1）
pnpm dlx wrangler d1 execute DB --file=./test-data.sql --remote # 导入示例账号
pnpm dev
```

示例账号：`demo@example.com` / 密码：`Passw0rd!`，租户 `tenant-demo`，客户端 `demo-web`。

## 部署到 Cloudflare Pages
- 生产：`pnpm deploy`（等价于 `pnpm deploy:prod`）
- 日志：`pnpm logs:prod`

## SSO Callback 复现脚本
- 脚本位置：`./scripts/repro-sso-callback.sh`
- npm/pnpm 调用：`pnpm repro:sso:callback -- "<callback_base_url>" "<code>" "<state>" "<state_cookie>" "<verifier_cookie>" "<return_cookie>"`
- 直接 bash：`bash ./scripts/repro-sso-callback.sh "<callback_base_url>" "<code>" "<state>" "<state_cookie>" "<verifier_cookie>" "<return_cookie>"`
- 可选参数：第 7~9 个参数可覆盖 cookie 名（默认 `blog_sso_state` / `blog_sso_verifier` / `blog_sso_return`）
- 产物目录：默认 `/tmp/sso-callback-repro-<timestamp>`，也可通过 `SSO_REPRO_OUT_DIR` 自定义

脚本会固定执行 3 个分支并输出 `HTTP`、`x-request-id`、`content-type`、响应体：
- `clean_cookie`：不带 cookie，使用原始 `state`
- `state_mismatch_with_cookie`：带 cookie，故意篡改 `state`
- `provider_exchange`：带 cookie，使用正确 `state`

建议转发给团队的关键信息：
- 三个分支对应的 `x-request-id`
- `provider_exchange` 的响应体（尤其是 `sso token exchange failed: upstream returned html response (status=400)` 场景下的 HTML 片段）
- `return_cookie` 是否为 `https` 回跳地址且与 provider callback 完全一致

## 环境变量（wrangler.account-*.toml）与 Secrets

> **密钥一律用 `wrangler pages secret put <NAME> --project-name cloudflare-sso`，绝不写进任何 toml。**
> 这个仓库是公开的：曾经误提交过签名私钥（已于 2026-10 轮换，见 `docs/KEY_ROTATION.md`）。

- `DB`：D1 binding（保持现有配置）
- `JWT_PRIVATE_KEY`（**secret**）：RS256 PKCS8 私钥
- `JWT_KID`：JWKS kid；**每次换 key 必须同时换 kid**
- `JWT_ISSUER`：`https://your-domain`（用于 `iss` 与发现文档）
- `PASSWORD_PEPPER`：额外的密码 pepper
- `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS`：Token 时长
- `DEFAULT_CLIENT_ID`：登录/注册未传 `client_id` 时使用的默认 client（例如生产可设 `misonote-app-web`）
- `ADMIN_CLIENT_IDS`：除 `DEFAULT_CLIENT_ID` 外，还有哪些 client 的 token 可以调用管理接口（逗号分隔，可选）
- `PLATFORM_TENANT_ID`：平台租户（可选，默认取 `DEFAULT_CLIENT_ID` 所在租户），其 admin 才能 bootstrap 应用
- `SESSION_MAX_AGE_SECONDS`：会话绝对寿命，默认一年
- `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET`（**secret**）：GitHub OAuth 应用凭据
- `OAUTH_GITHUB_REDIRECT_URI`：可选，GitHub 回调地址（默认 `${origin}/api/auth/oauth/callback?provider=github`）
- `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET`（**secret**）：Google OAuth 应用凭据
- `OAUTH_GOOGLE_REDIRECT_URI`：可选，Google 回调地址（默认 `${origin}/api/auth/oauth/callback?provider=google`）

- `SIWA_ENABLED` / `STORE_CLIENTS_SOCIAL_LOGIN`：通过 Apple 登录与商店版客户端的第三方登录开关
- `APPLE_TEAM_ID` / `APPLE_SERVICES_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`（secrets）：通过 Apple 登录
- `ACCOUNT_HOOK_URLS` / `ACCOUNT_HOOK_SECRET`（secret）：账号合并、删除时通知已连接应用

通过 Apple 登录、登录方式绑定与账号合并见 `docs/SIGN_IN_WITH_APPLE.md`。
更多细节见 `docs/DEPLOY.md` 与 `docs/WRANGLER_CONFIG.md`。
账号中心回归清单见 `docs/ACCOUNT_CENTER_QA_CHECKLIST.md`。
