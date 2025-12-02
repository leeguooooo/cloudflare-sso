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
   - 应用到 Production 和 Preview

### 2. 配置环境变量

在同一个 Settings 页面，Environment variables，添加：

| 变量名 | 值 |
|--------|-----|
| `JWT_PRIVATE_KEY` | (从 `wrangler.account-test.toml` 复制) |
| `JWT_KID` | `primary` |
| `JWT_ISSUER` | `https://cloudflare-sso.pages.dev` |
| `PASSWORD_PEPPER` | `change-me` |
| `RECORDING_JWT_SECRET` | `test-secret-change-me` |
| `ACCESS_TOKEN_TTL_SECONDS` | `600` |
| `REFRESH_TOKEN_TTL_SECONDS` | `1209600` |
| `CDN_BASE_URL` | `https://cdn.example.com` |

### 3. 重新部署

```bash
pnpm deploy:test
```

## 验证配置

```bash
curl 'https://cloudflare-sso.pages.dev/api/auth/login' \
  -H 'content-type: application/json' \
  --data-raw '{"email":"demo@example.com","password":"Passw0rd!","tenant_id":"tenant-demo","client_id":"demo-web"}'
```

应该返回成功响应，而不是 500 错误。
