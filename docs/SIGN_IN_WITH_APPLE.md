# 通过 Apple 登录、登录方式绑定与账号合并

## Apple 开发者后台（Certificates, Identifiers & Profiles，团队 6ZPXG4KVVS）

1. **App ID `com.paste.native`** → Capabilities 勾选 **Sign in with Apple**，选 *Enable as a primary App ID*。
   在它的 Sign in with Apple 配置里填 **Server-to-Server Notification Endpoint**：
   `https://account.leeguoo.com/api/auth/apple/notifications`
2. **Services ID**：Identifier `com.leeguoo.account.siwa`，Description `leeguoo account`（用户在 Apple 授权页看到的名字）。
   勾选 Sign in with Apple → Configure：
   - Primary App ID：`com.paste.native`
   - Domains and Subdomains：`account.leeguoo.com`
   - Return URLs：`https://account.leeguoo.com/api/auth/apple/callback`
   如果后台要求下载域名验证文件，把文件内容存进 secret `APPLE_DOMAIN_ASSOCIATION`，
   页面 `https://account.leeguoo.com/.well-known/apple-developer-domain-association.txt` 就会返回它。
3. **Key**：Keys → 新建，勾选 Sign in with Apple，Configure 里 Primary App ID 选 `com.paste.native`。下载 `AuthKey_<KEYID>.p8`（只能下载一次）。

## Secrets（Cloudflare Pages 项目 cloudflare-sso）

```bash
export CLOUDFLARE_ACCOUNT_ID=3d050f54dac3fb90c344e3889ec45792
printf '6ZPXG4KVVS'                | npx wrangler pages secret put APPLE_TEAM_ID     --project-name cloudflare-sso
printf 'com.leeguoo.account.siwa'  | npx wrangler pages secret put APPLE_SERVICES_ID --project-name cloudflare-sso
printf '<KEYID>'                   | npx wrangler pages secret put APPLE_KEY_ID      --project-name cloudflare-sso
npx wrangler pages secret put APPLE_PRIVATE_KEY --project-name cloudflare-sso < AuthKey_<KEYID>.p8
```

`ACCOUNT_HOOK_SECRET` 两边必须相同：issuer（`wrangler pages secret put ACCOUNT_HOOK_SECRET --project-name cloudflare-sso`）
与 Pastyx API（`cd paste/apps/api && npx wrangler secret put ACCOUNT_HOOK_SECRET`）。

Pages 的变量和 secret 在下一次部署后生效：改完要重新部署（见 DEPLOY.md）。

## 开关（wrangler.account-prod.toml 的 [vars]，改完重新部署）

| 变量 | 值 | 作用 |
| --- | --- | --- |
| `SIWA_ENABLED` | `0` | 关闭（Apple 回调返回 501，按钮不显示） |
| | `test` | 只在 `/login?siwa=1`（及该页发起的注册/授权）显示 Apple；账号中心可绑定 Apple。用来在生产上先验证 |
| | `1` | 所有客户端显示 Apple |
| `STORE_CLIENTS_SOCIAL_LOGIN` | `0` / `1` | `1` 时商店版客户端（`leeguoo-pastyx-ios`、`misonote-paste-macos`）也显示 Google / GitHub。只在 `SIWA_ENABLED=1` 且 Apple secrets 齐全时生效（Guideline 4.8：不能让商店客户端只看到 Google/GitHub 而没有 Apple） |

上线顺序：设 secrets → `SIWA_ENABLED=test` 部署 → 用测试 Apple ID 在 `https://account.leeguoo.com/login?siwa=1` 登录、在账号中心绑定/解绑 →
`SIWA_ENABLED=1` 部署 → 在 iPhone / Mac 上确认登录页第一个是 Apple → `STORE_CLIENTS_SOCIAL_LOGIN=1` 部署。

## 行为说明

- 登录方式 = 密码（`global_accounts.password_set = 1`）+ `global_external_identities` 里的每个第三方身份（apple / google / github）。
  社交注册的账号 `password_set = 0`（随机密码，用户不知道），可在账号中心设置密码。
- 绑定、解绑、首次设置密码需要 15 分钟内登录过（`sessions.created_at`）；不能移除最后一种登录方式。
- 第三方登录时邮箱与已有账号相同但身份未绑定：Google / GitHub 且邮箱经对方验证 → 自动绑定（沿用原有行为，现在只限已验证邮箱）；
  Apple 或未验证邮箱 → 不自动绑定，登录页提示先用原方式登录，再在「账号中心 → 登录方式」绑定。
- 绑定的身份已属于另一个账号 → 账号中心显示合并确认。合并：另一个账号的登录方式、API key、各租户用户（订阅、权益、角色）转到当前账号；
  只有另一个账号有密码时，当前账号接管它的邮箱和密码；已连接应用通过 `ACCOUNT_HOOK_URLS`（`…/merge`、`…/delete`）合并数据；
  任一账号在 Pastyx 开着端到端加密时拒绝合并。另一个账号最后被删除。可重试、幂等（`account_merges` 记录进度）。
- Apple 通知：`email-disabled/enabled` 记录在身份上；`consent-revoked` 撤销该账号所有会话并丢弃 Apple refresh token（绑定保留）；
  `account-delete` 移除 Apple 身份并撤销会话，若 Apple 是唯一登录方式则删除整个账号（含 Pastyx 数据）。
- 删除账号（`DELETE /api/account`）时调用 Apple `/auth/revoke` 撤销保存的 refresh token。
- OAuth state 存在 D1 `oauth_states`，cookie 只放随机 state（以前整个 JSON 放在 cookie 里，用户可改其中的绑定目标账号）。
