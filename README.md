# Cloudflare 全栈开源 SSO

Nuxt 4 + Cloudflare Pages + D1/KV/Workers 的单仓 SSO。提供 OAuth2/OIDC Provider（授权码 + PKCE）、RS256 JWT/JWKS、刷新 Token 旋转、登录/注册、会话撤销等基础能力，支持多租户与国际化（EN/简体）。

## 特性
- 单仓全栈：Nuxt SPA + Nitro Functions（Pages Functions）即 Workers 端点
- OIDC: `/.well-known/openid-configuration`、`/authorize`、`/token`、`/userinfo`、`/jwks.json`
- 认证：注册、登录、刷新、登出，Refresh Token 存 D1，Access/ID Token 为 RS256
- 多租户：tenant + client 隔离，客户端重定向白名单
- i18n：内置 EN / 简体，登录/注册页可切换
- 部署：一条命令部署到 Cloudflare Pages，支持多账号 wrangler 切换

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
