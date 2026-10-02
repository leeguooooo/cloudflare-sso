# 快速配置 Cloudflare Pages

## 方法一：使用脚本自动配置（推荐）

### 1. 创建 Cloudflare API Token

```bash
# 访问: https://dash.cloudflare.com/profile/api-tokens
# 创建 token，权限: Cloudflare Pages:Edit, D1:Edit
# 然后运行:
export CLOUDFLARE_API_TOKEN=your_token_here
```

### 2. 运行配置脚本

```bash
# 使用 Node.js 脚本（推荐）
pnpm setup:pages

# 或使用 Shell 脚本
pnpm setup:pages:sh
```

脚本会自动：
- ✅ 配置 D1 数据库绑定
- ⚠️  环境变量需要手动在 Dashboard 中设置（见下方）

## 方法二：手动配置（如果脚本失败）

### 1. 配置 D1 数据库绑定

1. 访问: https://dash.cloudflare.com → Pages → `cloudflare-sso`
2. Settings → Functions → D1 Database bindings
3. Add binding:
   - Variable name: `DB`
   - D1 Database: `cf-nuxt-pages-db`
   - 应用到 Production

### 2. 配置 Secrets 与变量

**密钥只用 secret，不要放进 Dashboard 的明文变量或任何 toml：**

```bash
wrangler pages secret put JWT_PRIVATE_KEY --project-name cloudflare-sso      # RS256 PKCS8 私钥
wrangler pages secret put OAUTH_GOOGLE_CLIENT_SECRET --project-name cloudflare-sso
wrangler pages secret put OAUTH_GITHUB_CLIENT_SECRET --project-name cloudflare-sso
```

非敏感变量（`JWT_KID`、`JWT_ISSUER`、`DEFAULT_CLIENT_ID`、TTL 等）放在 `wrangler.account-prod.toml` 的 `[vars]`。
换 key 的流程见 `docs/KEY_ROTATION.md`。

### 3. 重新部署

```bash
pnpm deploy:prod
```

## 验证配置

```bash
curl 'https://cloudflare-sso.pages.dev/api/auth/login' \
  -H 'content-type: application/json' \
  --data-raw '{"email":"demo@example.com","password":"Passw0rd!","tenant_id":"tenant-demo","client_id":"demo-web"}'
```

应该返回成功响应，而不是 500 错误。
