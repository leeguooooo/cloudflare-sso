# Cloudflare 全栈开源 SSO

Nuxt 4 + Cloudflare Pages + D1/KV/Workers 的单仓 SSO。提供 OAuth2/OIDC Provider（授权码 + PKCE）、RS256 JWT/JWKS、刷新 Token 旋转、登录/注册、会话撤销等基础能力，支持多租户与国际化（EN/简体）。

## 特性
- 单仓全栈：Nuxt SPA + Nitro Functions（Pages Functions）即 Workers 端点
- OIDC: `/.well-known/openid-configuration`、`/authorize`、`/token`、`/userinfo`、`/jwks.json`、`/revoke`（RFC 7009）、`/logout`（RP-Initiated Logout）、`/device/code`（RFC 8628 设备授权，给 Apple TV 这类不方便输入的设备）
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
| App 内原生通过 Apple 登录 | 同上 Apple secrets；App 的 bundle id 加进 `APPLE_APP_IDS` | 接口返回 501 |
| 首次使用免费试用 | 变量 `TENANT_SIGNUP_TRIALS='{"<tenant_id>":{"entitlement_key":"…","days":N}}'`（**生产**：`tenant-jrkan` → `jrkan.premium` 90 天） | 不发试用 |
| 爱发电会员 | 变量 `AFDIAN_USER_ID`、`AFDIAN_PLANS`；可选 secret `AFDIAN_TOKEN`（下单二次确认 + 对账补单） | `/membership/<app>` 显示「会员购买暂未开放」，下单接口 404 |
| 账单对账定时任务 | Pages secret `RECONCILE_SECRET` + 部署 `workers/billing-reconcile`（**生产已启用**，每 30 分钟） | 不对账 |

## 新增（统一登录简化方案，Phase 1）
- 全局账号模型：`global_accounts` 作为统一凭据源，`users.global_account_id` 做租户映射
- 应用开通接口：`POST /api/admin/apps/bootstrap`（`blog`/`paste`/`misonote`/`cherry`/`jrkan`/`fishing`）
- 自动开通租户用户：`POST /api/auth/provision-tenant-user`
- 管理面安全收口：`/api/admin/*`、`/api/access/*`、billing 管理接口要求 Bearer Access Token、admin 权限，且 token 必须签发给账号中心 client（`DEFAULT_CLIENT_ID` 或 `ADMIN_CLIENT_IDS`）
- Web 双轨：登录仍返回 Bearer Token，并写入 HttpOnly refresh cookie
- Billing 五表已落地：`products`、`plans`、`subscriptions`、`entitlements`、`subscription_events`

## 体验目标（已锁定）
- 账号中心支持中文和英文：页脚切换，选择存在浏览器里（`sso_account_lang`）；没选过时按浏览器语言，中文浏览器看中文，其他看英文

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

## 接入方的用户标识（canonical principal）
面向接入方的精简版接入文档在线上 `/developers`（`pages/developers.vue`），改接口时一起更新。

App 后端验完 access token 后只认这几个 claim：

| claim | 含义 | 用法 |
| --- | --- | --- |
| `iss` | `https://account.leeguoo.com` | 必须校验 |
| `sub` | 这个人在**该 App 租户**里的用户 id | App 自己表里的用户主键就存它；同一个人在不同 App 的 `sub` 不同 |
| `tid` | 租户 id | 必须等于本 App 的租户 |
| `gaid` | 全局账号 id，同一个人在所有 App 都相同 | 只用于跨 App 关联（例如统一会员），不要当本 App 主键 |
| `aud` | 签发给哪个 client | 必须是本 App 的 client |
| `roles` / `perms` | 该租户里的角色和权限 | 管理功能鉴权 |
| `sid` | 会话 id | 想立刻感知登出就调 `/userinfo` |

事件 Webhook（App 后端订阅自己用户的变化，不用轮询）：
- 后台 `/admin/webhooks` 或 `POST /api/admin/webhooks { tenant_id, action: create, url, events }` 注册 https 地址；创建和 `rotate_secret` 时返回签名密钥，只出现这一次
- 事件：`account.suspended` / `account.restored` / `account.deleted` / `account.merged` / `account.sessions_revoked` / `account.mfa_reset` / `entitlement.changed`（另有测试用的 `webhook.ping`）。请求体 `{ id, type, created, tenant_id, data: { sub, global_account_id, … } }`，`sub` 是该 App 租户里的用户 id
- 校验：`X-Leeguoo-Signature: t=<unix>,v1=<hex>`，v1 = HMAC-SHA256(密钥, `"<t>.<原始请求体>"`)；拒绝太旧的 t，按 `X-Leeguoo-Delivery` 去重（重试用同一个 id）
- 非 2xx 会在 5 分钟、30 分钟、2 小时、12 小时、24 小时后重试（由每 30 分钟的对账任务执行），之后标为 failed，可在后台手动重发。签名密钥加密存放，需要 secret `MFA_SECRET_KEY` 或 `PASSWORD_PEPPER_V2`
- 这是通知；账号合并、删除时阻塞调用的 `ACCOUNT_HOOK_URLS` 保持不变

旧登录路径下线（各 App 自己的 header 身份、KV 会话、本地 cookie）：
- App 后端定期（例如每 5 分钟）汇总上报：`POST /api/metrics/legacy-auth { tenant_id, reports: [{ client_id, path, legacy_hits, total_requests }] }`，次数按 UTC 天累加。服务 token 需 `metrics:legacy.write`
- 后台首页「Legacy sign-in paths」卡片（`GET /api/admin/legacy-auth?tenant_id=`）显示每条旧路径的占比；连续 7 天都有上报且都低于 0.1% 时标为 `ready to remove`，这时可以删掉那条兼容代码

老用户迁移（把 App 自己的用户表映射到 SSO）：
- `POST /api/admin/identity-mappings/import { tenant_id, source_system, records, create_missing?, dry_run? }`：每批最多 100 条，幂等。规则：已有映射 → `unchanged`；指定 `global_account_id` → `manual`；源系统**验证过**的邮箱且 SSO 有这个账号 → `linked`；验证过但没账号且 `create_missing` → `created`（无密码，用户用第三方登录或「忘记密码」设密码）；其余（邮箱没验证、找不到账号、账号停用）→ `needs_review`，不写任何东西。没验证的邮箱一律不自动关联，避免别人在旧 App 里填了你的邮箱就拿到你的 SSO 账号。租户管理员，或带 `identity:mappings.write` 的服务 token
- `GET /api/admin/identity-mappings?tenant_id=&source_system=&source_user_id=`：查映射，App 后端用老 id 换新 `sub`（服务 token 需 `identity:mappings.read`）
- `POST /api/admin/identity-mappings/revert { tenant_id, mapping_id | run_id }`：撤销错误映射（只有租户管理员），不删账号，返回这次导入新建的账号供人工核对
- 后台页面：`/admin/migrations`（先 Dry run，再导入；可整批撤销）。账号合并时映射跟着转到保留的账号，删号时一起删除

## 账号与登录接口（补充）
- `POST /api/auth/password/forgot { email, client_id? }`：发送 30 分钟有效的重置链接；不论邮箱是否存在都返回 `{ ok: true }`；按 IP 与邮箱限流
- `POST /api/auth/password/reset { token, password }`：一次性令牌；成功后吊销该账号所有会话，并视为邮箱已验证
- `POST /api/account/email/verify`：给当前邮箱发验证链接；`POST /api/account/email/change { new_email }`：需近期登录，向新邮箱发确认链接，点开后才生效
- `GET /api/auth/email/verify?token=`：邮件链接落地，回跳账号中心
- 新设备登录提醒：账号在 180 天内没用过的浏览器 / App（按去掉版本号的 User-Agent 比较，浏览器升级不算新设备）上登录成功时，发邮件给账号邮箱（密码、两步验证、通行密钥和第三方登录都算；注册时的第一次登录不发）。需要邮件已配置；用户在账号中心「安全性与登录」关闭，接口 `GET` / `PATCH /api/account/preferences { sign_in_alerts }`。邮件在响应之后发送，不拖慢、也不影响登录
- 通行密钥（passkey / WebAuthn）：
  - 登录：`POST /api/auth/passkey/options` → `{ challenge_id, publicKey }` 给 `navigator.credentials.get()`；`POST /api/auth/passkey/verify { challenge_id, client_id?, credential }`（二进制字段 base64url），成功响应与 `/api/auth/login` 相同，不再要两步验证码。按凭据和 IP 限流
  - 管理：`GET /api/account/passkeys`；`POST /api/account/passkeys { action: register_options | register | rename | delete }`，添加和删除要求 15 分钟内登录过；每个账号最多 10 个
  - 认证器没有验证用户（没有指纹 / 面容 / PIN）时，开了两步验证的账号仍会收到 `mfa_required`，要再输验证码
  - RP ID 是 `WEBAUTHN_RP_ID`，默认取 `JWT_ISSUER` 的主机名（`account.leeguoo.com`）：只能在账号域名上用，其他 leeguoo.com 子站拿不到。只支持 ES256 / RS256，不校验 attestation；签名计数不前进视为克隆，拒绝登录
  - 账号合并时通行密钥转到保留的账号，删号时一起删除
- 两步验证（TOTP + 备用码，只保护邮箱密码登录；Apple / Google / GitHub / 微信登录不受影响）：
  - `POST /api/auth/login` 对开启了两步验证的账号不发 token，返回 `{ mfa_required: true, challenge, methods: ["totp", "recovery"] }`；`challenge` 5 分钟有效
  - `POST /api/auth/mfa/verify { challenge, code }`：`code` 是 6 位验证码或备用码，成功响应与 `/api/auth/login` 相同（用了备用码时多一个 `recovery_codes_remaining`）。错误码 `401 invalid_code` / `401 mfa_challenge_expired`；输错计入该邮箱的登录失败次数（15 分钟 10 次后 `429`）。每个 30 秒的验证码只能用一次
  - `GET /api/account/mfa` → `{ enabled, enabled_at, recovery_codes_remaining }`；`POST /api/account/mfa { action }`：`start` → `{ secret, otpauth_uri }`，`confirm { code }` → `{ recovery_codes }`（只出现这一次），`regenerate_recovery_codes { code }`，`disable { code }`。都要求 15 分钟内登录过（否则 `403 reauth_required`），账号要先有密码（否则 `400 password_required`）
  - 密钥用 AES-GCM 加密存放，密钥材料取 secret `MFA_SECRET_KEY`，没有就用 `PASSWORD_PEPPER_V2`（每行记下用的是哪个），两个都没有时接口返回 500，不会退回公开的 `PASSWORD_PEPPER`。`MFA_SECRET_KEY` 只能用 `wrangler pages secret put` 配，不能写进 toml；备用码只存 HMAC。账号合并时，保留的账号没开两步验证就继承被合并账号的
  - 用户丢了手机和备用码：平台管理员在 `/admin/accounts/:id` 点「Reset 2FA」（`POST /api/admin/accounts/:id { action: "reset_mfa" }`），同时登出所有会话
  - 直接调 `/api/auth/login` 的客户端（非托管登录页）要处理 `mfa_required`，否则开了两步验证的用户登录不了
- `GET /api/account/export`：下载账号数据（资料、登录方式、会话、完整活动记录、订阅与权益）
- `POST /api/auth/wechat/miniprogram { client_id, code }`：`wx.login()` 的 code 换 SSO token（同 `/token` 响应）。有 unionid 时网站与各小程序落到同一个账号
- `POST /api/auth/apple/native { client_id, identity_token, nonce, authorization_code?, given_name?, family_name? }`：App 内原生「通过 Apple 登录」换 SSO token（同 `/token` 响应），详见下文
- 管理后台（平台管理员可管理所有租户，租户管理员只能管自己的租户）：
  - `GET /api/admin/tenants`：可管理的租户列表（含用户数、client 数），后台各页的租户下拉框用它
  - `GET /api/admin/accounts?q=&status=`、`GET /api/admin/accounts/:id`（仅平台管理员）：全局账号目录与详情，详情包括各 App 的租户用户、登录方式、会话、权益、订阅、最近活动；不返回密码哈希和第三方 refresh token
  - `POST /api/admin/accounts/:id { action }`（仅平台管理员）：`suspend` / `restore`（停用期间不能登录任何 App，停用时立即登出所有会话）、`revoke_sessions`、`grant_entitlement { tenant_id, entitlement_key, valid_to?, note? }` / `revoke_entitlement { tenant_id, entitlement_key }`。手动权益写成 `provider = manual` 的账单事件，收回只影响手动发放的权益
  - `GET /api/admin/audit?tenant_id=&action=&account=&before=&limit=`：审计日志，`action` 按前缀匹配，`account`（全局账号 id，仅平台管理员）查这个人在所有 App 的记录，用返回的 `next_before` 翻页
- `GET /api/admin/growth?tenant_id=&days=30`（租户管理员）：用户总数、每天新增、日 / 周 / 月活跃（当天登录或刷新过会话），后台首页「Users」卡片
- `GET /api/admin/users/export?tenant_id=`（租户管理员）：该租户全部用户的 CSV（含 `sub`、邮箱、状态、角色、注册和最近活跃时间），带 BOM 方便 Excel 打开，单元格防公式注入；每次导出写审计
- 管理：`GET/POST /api/admin/users`（禁用/启用/全部登出）、`GET /api/admin/metrics`（登录健康度）、`GET /api/billing/subscriptions`、`GET /api/billing/events`
- 内部：`POST /api/internal/billing/reconcile`（`RECONCILE_SECRET`，由 `workers/billing-reconcile` 每 30 分钟调用；可配 `ALERT_WEBHOOK_URL` 推送告警到飞书/Discord/Slack）

## App 内原生通过 Apple 登录
`POST /api/auth/apple/native`（JSON）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `client_id` | 是 | SSO client，例如 `leeguoo-jrkan-tv` / `leeguoo-jrkan-ios` / `leeguoo-fishing-ios` |
| `identity_token` | 是 | `ASAuthorizationAppleIDCredential.identityToken`，`aud` 必须在 `APPLE_APP_IDS` 里 |
| `nonce` | 是 | 原始 nonce；发给 Apple 的是它的 SHA-256 小写 hex，token 的 `nonce` claim 必须等于它 |
| `authorization_code` | 否 | 带上时服务端用 `client_id = token 的 aud`（bundle id）去 Apple 换 refresh token，删号时用来撤销。换失败只记日志，不影响登录 |
| `given_name` / `family_name` | 否 | Apple 只在第一次授权时给名字 |

- 成功：`200 { token_type, access_token, id_token, refresh_token, expires_in, scope }`，用户开通到该 client 的租户
- 失败一律 `{ error, error_description }`：`400 invalid_request`（缺字段）/ `400 invalid_client`（未知 client）/ `401 invalid_token`（签名、aud、nonce、过期不对）/
  `409 account_exists`（邮箱属于另一个没绑定 Apple 的账号，响应多一个 `email`；先用原方式登录再到账号中心绑定）/ `429 too_many_requests`（每 IP 10 分钟 60 次）/
  `501 not_configured`（Apple secrets 不全或 `SIWA_ENABLED=0`）/ `502 server_error`（拿不到 Apple 公钥）
- 审计：`auth.apple_native`

## 设备授权（RFC 8628，Apple TV）
1. 设备：`POST /device/code`（form 或 JSON）`client_id`、可选 `scope` →
   `200 { device_code, user_code: "XXXX-XXXX", verification_uri: "<issuer>/device", verification_uri_complete: "<issuer>/device?user_code=XXXX-XXXX", expires_in: 600, interval: 5 }`。
   只有 `grant_types` 含 `urn:ietf:params:oauth:grant-type:device_code` 的 client 能用（否则 `400 unauthorized_client`）；未知 client `401 invalid_client`；每 IP 10 分钟 30 次（`429 slow_down`）。
   `device_code` 库里只存 SHA-256；`user_code` 是 8 个不含元音和 0/O/1/I 的字母，不区分大小写、可省略横线。
2. 用户在手机/电脑打开 `verification_uri_complete`（或 `/device` 手动输入）。没登录会跳到托管登录页（`/login?continue=/device?...&client_id=<设备的 client>`，Apple / 密码 / Google 等都能用），
   登录后看到应用名、设备、代码、当前账号（可切换），点「允许」或「拒绝」。
3. 设备每 `interval` 秒轮询 `POST /token`：`grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id=…`。
   未批准 `400 authorization_pending`；比 interval 快 `400 slow_down`（该 code 的 interval 永久 +5 秒）；被拒 `400 access_denied`；过期 `400 expired_token`；已用过或不属于该 client `400 invalid_grant`。
   批准后只发一次 token（与授权码换 token 同样的响应），用户开通到该 client 的租户，审计 `auth.token.device_code`。

页面用的接口（只认账号域名下的 `sso_refresh_token` 会话 cookie，和 `/authorize` 一样不接受 Bearer）：
- `GET /api/auth/device/lookup[?user_code=]` → `{ signed_in, email, user_code, client_id, client_name, device_name, status, expires_in }`；
  未知代码 `404 invalid_user_code`。带 `user_code` 时每 IP 10 分钟 30 次（`429 too_many_requests`）
- `POST /api/auth/device/verify { user_code, action: "approve" | "deny" }` → `{ ok: true, status: "approved" | "denied", client_id, client_name, device_name }`；
  `401 login_required` / `404 invalid_user_code` / `409 already_handled` / `410 expired_user_code` / `403 invalid_origin`（跨站请求）/ `429 too_many_requests`（每 IP 10 分钟 20 次）。审计 `auth.device.approve` / `auth.device.deny`

## 首次使用免费试用
- 账号第一次登录某个配置了试用的租户（任何方式：密码、Apple 网页/原生、Google、GitHub、微信、授权码、设备授权，或刷新 token）时，
  发一条权益：`source = "promo"`、`meta_json.trial = true`、`valid_from = 现在`、`valid_to = 现在 + days`。老账号（比如 Pastyx 用户）第一次用 JRKAN 也会拿到。
- 每个 global account 每个租户只发一次：`trial_grants` 表记账（主键 `global_account_id, tenant_id`），重复登录、租户用户被删后重建、并发登录都不会再发；
  账号合并时记账跟着转到保留的账号，合并也不会多出一次试用。删号时一起删除。
- 发试用失败只记 `signup trial grant failed` 日志，不影响登录。
- `GET /api/billing/entitlements` 的每一行多一个 `trial` 布尔值；试用行形如
  `{ entitlement_key: "jrkan.premium", source: "promo", trial: true, status: "granted", valid_from, valid_to, subscription_id: null, plan_key: null, … }`，客户端用 `valid_to` 算剩余天数。

## 爱发电会员（afdian）
- 购买页：`https://account.leeguoo.com/membership/<app_key>`（例如 `/membership/jrkan`）。要求账号域名下的登录会话，没登录跳 `/login?continue=…`；
  显示当前账号（可切换）、会员状态（试用剩余天数 / 会员到期日 / 已过期 / 未开通）、价格和「开通/续费 1 个月」。页面不加载广告与统计。
- 页面接口（只认 `sso_refresh_token` cookie，跨站 Origin 返回 403）：
  - `GET /api/billing/afdian/membership?app_key=` → `{ signed_in, email, app_key, available, name, price_label, status: "member"|"trial"|"expired"|"none", valid_to }`
  - `POST /api/billing/afdian/checkout { app_key, month: 1..12 }` → `{ url, checkout_id, month }`；`404 not_available`（没有该 app 的方案）/ `401 login_required` / `400 invalid_request` / `429 too_many_requests`
- `POST /api/billing/afdian/webhook`：校验爱发电 RSA-SHA256 签名（签名不对只记日志、不入库、不生效，但仍回 `{ec:200}`：爱发电后台保存 Webhook 地址时发的示例订单没有有效签名）。订单按 `custom_order_id`（购买页生成）或之前绑定过的爱发电用户匹配账号，
  匹配后记住「爱发电用户 ↔ 账号」，以后的自动续费和直接在爱发电下的单都能对上。每个 `out_trade_no` 只生效一次；对不上的订单记为 `unmatched` 等管理员处理。
  配了 `AFDIAN_TOKEN` 时再用开放接口 `query-order` 确认金额 / 方案 / 用户一致，不一致记 `rejected`。最终结果都回 `{ec:200}`，临时失败回 `{ec:500}` 让爱发电重推。
- 生效规则：权益（例如 `jrkan.premium`）从「现在」与「该权益当前最晚到期时间（含试用）」中较晚者起，延长 `month × days_per_month` 天；
  权益行 `source = "plan"`、无订阅、`meta_json.provider = "afdian"`，续费时延长同一行。没开过 App 的账号会先开通租户用户。
- 对账：`workers/billing-reconcile` 每 30 分钟的对账在配了 `AFDIAN_TOKEN` 时拉 `query-order` 第一页，补上漏推的已付款订单。
- 管理：`GET /api/admin/afdian/orders?status=unmatched|matched|rejected|error`；`POST /api/admin/afdian/orders { out_trade_no, global_account_id | email }` 把未匹配订单绑定到账号（平台管理员）。
- `GET /api/billing/entitlements` 每行有 `trial`、`provider`（`"afdian"` / `null`），并新增 `expired_entitlements: [{ entitlement_key, source, valid_to, trial, provider }]`：
  当前已没有的权益各取最近一次过期的记录，App 用它显示「会员已过期」。

上线步骤（owner）：
1. 爱发电创作者后台新建方案：每月 ¥1.99，记下方案 ID（`plan_id`，方案链接里的那串）。
2. 开发者页面（https://ifdian.net/dashboard/dev）拿 `user_id` 和 API `token`；Webhook URL 填 `https://account.leeguoo.com/api/billing/afdian/webhook`。
3. `wrangler.account-prod.toml` 填 `AFDIAN_USER_ID = "<user_id>"` 和
   `AFDIAN_PLANS = '{"<plan_id>":{"app_key":"jrkan","tenant_id":"tenant-jrkan","entitlement_key":"jrkan.premium","days_per_month":31,"price_label":"¥1.99/月","name":"JRKAN 会员"}}'`。
4. `npx wrangler pages secret put AFDIAN_TOKEN --project-name cloudflare-sso`（粘贴 token）。
5. `pnpm deploy`，然后用一个测试账号在 `/membership/jrkan` 买一个月，确认 `GET /api/admin/afdian/orders?status=matched` 里有这单、App 里到期日后延 31 天。

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
  - 入参：`app_key`（单个）或 `app_keys`（批量，字符串数组）；可选值 `blog` / `paste` / `misonote` / `cherry` / `jrkan` / `fishing`
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

JRKAN 客户端约定（tvOS / iOS / Mac，bundle id 都是 `com.leeguoo.jrskan.tv`，租户 `tenant-jrkan`，只走内部 TestFlight，不是商店客户端）：
- `leeguoo-jrkan-tv`：Apple TV，设备授权（`refresh_token` + `urn:ietf:params:oauth:grant-type:device_code`），没有 redirect URI；也可以用 `/api/auth/apple/native`
- `leeguoo-jrkan-ios`：iPhone / iPad / Mac，授权码 + PKCE，`redirect_uri` 为 `com.leeguoo.jrskan.tv:/oauth/callback`；也可以用 `/api/auth/apple/native`
- 生产注册：`POST /api/admin/apps/bootstrap { "app_key": "jrkan" }`，或执行 `scripts/sql/jrkan-clients.sql`（幂等，效果相同，只是不会把调用者设为租户 admin）

钓鱼 App 客户端约定（iOS，bundle id `com.leeguoo.fishing`，租户 `tenant-fishing`，App Store 客户端）：
- `leeguoo-fishing-ios`：主路径是 `/api/auth/apple/native`；其他登录方式走授权码 + PKCE（ASWebAuthenticationSession），`redirect_uri` 为 `com.leeguoo.fishing:/oauth/callback`。在 `NATIVE_STORE_CLIENT_IDS` 里，Google / GitHub 跟随 `STORE_CLIENTS_SOCIAL_LOGIN`
- 生产注册：`POST /api/admin/apps/bootstrap { "app_key": "fishing" }`，或执行 `scripts/sql/fishing-clients.sql`；上线步骤见 `docs/SIGN_IN_WITH_APPLE.md`
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
- `GET /api/billing/entitlements/check?entitlement_key=`（可选 `user_id` / `tenant_id` / `as_of`）
  - 鉴权：同 `GET /api/billing/entitlements`
  - 行为：返回 `{ allowed, entitlement_key, source, trial, valid_to }`，并按 App（token 的 client）和权益 key 记每天的放行 / 拒绝次数。**App 判断付费功能请走这个接口**，后台首页才能看到各 App 的拒绝率
  - 管理：`GET /api/admin/entitlement-metrics?tenant_id=&days=7`（租户管理员，最多 90 天）→ 按 App + key 的 `allowed` / `denied` / `deny_rate` 和按天汇总
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
- `APPLE_APP_IDS`：逗号分隔的 App ID（bundle id），原生登录的 identity token 与 Apple 通知的 `aud` 必须在其中；第一个是 primary App ID（`com.paste.native`）
- `ACCOUNT_HOOK_URLS` / `ACCOUNT_HOOK_SECRET`（secret）：账号合并、删除时通知已连接应用

通过 Apple 登录、登录方式绑定与账号合并见 `docs/SIGN_IN_WITH_APPLE.md`。
更多细节见 `docs/DEPLOY.md` 与 `docs/WRANGLER_CONFIG.md`。
账号中心回归清单见 `docs/ACCOUNT_CENTER_QA_CHECKLIST.md`。
