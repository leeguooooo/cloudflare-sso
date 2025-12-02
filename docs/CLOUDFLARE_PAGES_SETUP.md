# Cloudflare Pages 配置指南

## 配置 D1 数据库绑定

Cloudflare Pages 项目需要手动在 Dashboard 中配置 D1 数据库绑定。

### 步骤：

1. 访问 Cloudflare Dashboard → Pages → `cloudflare-sso`
2. 进入 "Settings" → "Functions" → "D1 Database bindings"
3. 点击 "Add binding"
4. 配置：
   - **Variable name**: `DB`
   - **D1 Database**: 选择 `cf-nuxt-pages-db`
   - 应用到 **Production** 和 **Preview** 环境

### 或者使用 Wrangler CLI（推荐）

```bash
# 查看项目配置
wrangler pages project list

# 注意：D1 绑定需要通过 Dashboard 或 API 配置
# 目前 wrangler CLI 不支持直接绑定 D1 到 Pages 项目
```

## 配置环境变量

在 Cloudflare Dashboard 中设置环境变量：

1. 访问 Cloudflare Dashboard → Pages → `cloudflare-sso`
2. 进入 "Settings" → "Environment variables"
3. 添加以下变量（Production 和 Preview 都需要）：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `JWT_PRIVATE_KEY` | (你的私钥) | JWT 私钥（PKCS8 格式，多行） |
| `JWT_KID` | `primary` | JWT Key ID |
| `JWT_ISSUER` | `https://cloudflare-sso.pages.dev` | JWT 发行者 |
| `PASSWORD_PEPPER` | (随机字符串) | 密码加密盐值 |
| `RECORDING_JWT_SECRET` | (随机字符串) | 录制 JWT 密钥 |
| `CDN_BASE_URL` | `https://cdn.example.com` | CDN 基础 URL |
| `ACCESS_TOKEN_TTL_SECONDS` | `600` | Access Token 过期时间（秒） |
| `REFRESH_TOKEN_TTL_SECONDS` | `1209600` | Refresh Token 过期时间（秒） |

### 获取 JWT_PRIVATE_KEY

如果还没有生成，可以运行：

```bash
node -e "const crypto = require('crypto'); const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); console.log(privateKey);"
```

## 验证配置

配置完成后，重新部署应用：

```bash
pnpm deploy:test
```

然后测试登录接口：

```bash
curl 'https://cloudflare-sso.pages.dev/api/auth/login' \
  -H 'content-type: application/json' \
  --data-raw '{"email":"demo@example.com","password":"Passw0rd!","tenant_id":"tenant-demo","client_id":"demo-web"}'
```

## 常见问题

### 500 错误：Missing Cloudflare env bindings

- 检查 D1 数据库是否已绑定到 Pages 项目
- 检查环境变量是否已设置

### 500 错误：D1 binding DB not configured

- 确保在 Pages 项目设置中绑定了 D1 数据库
- 变量名必须是 `DB`

### 500 错误：Missing JWT_PRIVATE_KEY in env

- 在 Pages 项目设置中添加 `JWT_PRIVATE_KEY` 环境变量
- 确保私钥格式正确（包含 BEGIN/END 标记）
