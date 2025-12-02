# GitHub Actions 快速设置

## 1. 设置 GitHub Secrets

在 GitHub 仓库中设置以下 Secrets：

1. 进入仓库 → Settings → Secrets and variables → Actions
2. 点击 "New repository secret"
3. 添加以下 Secret：

### CLOUDFLARE_API_TOKEN

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 使用 "Edit Cloudflare Workers" 模板，或自定义权限：
   - `Account.Cloudflare Pages:Edit`
   - `Account.D1:Edit`
4. 复制 Token 并添加到 GitHub Secrets

## 2. 配置 Cloudflare Pages 环境变量（推荐）

敏感信息应该在 Cloudflare Dashboard 中设置，而不是提交到 Git：

1. 访问 Cloudflare Dashboard → Pages → `cloudflare-sso`
2. 进入 "Settings" → "Environment variables"
3. 添加以下变量（Production 和 Preview 环境都需要）：
   - `JWT_PRIVATE_KEY`: 你的 JWT 私钥（PKCS8 格式，多行）
   - `PASSWORD_PEPPER`: 密码加密盐值
   - `RECORDING_JWT_SECRET`: 录制 JWT 密钥
   - `JWT_ISSUER`: `https://cloudflare-sso.pages.dev`
   - `JWT_KID`: `primary`
   - `CDN_BASE_URL`: CDN 基础 URL
   - `ACCESS_TOKEN_TTL_SECONDS`: `600`
   - `REFRESH_TOKEN_TTL_SECONDS`: `1209600`

## 3. 检查配置文件

确保 `wrangler.account-test.toml` 和 `wrangler.account-prod.toml` 中的数据库 ID 正确：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-nuxt-pages-db"
database_id = "你的数据库ID"
```

## 4. 部署

### 自动部署

- **测试环境**: 推送到 `main` 或 `develop` 分支时自动部署
- **生产环境**: 推送 tag（格式：`v*`）时自动部署

### 手动部署

1. 在 GitHub 仓库中，点击 "Actions" 标签
2. 选择对应的工作流（Deploy to Test/Production）
3. 点击 "Run workflow"

## 5. 验证部署

部署完成后，访问：
- 测试环境: https://cloudflare-sso.pages.dev
- 查看部署日志: GitHub Actions → 对应的工作流运行

## 安全建议

⚠️ **重要**: 如果 `wrangler.account-*.toml` 包含敏感信息（如 JWT_PRIVATE_KEY），建议：

1. 使用 `wrangler.account-*.toml.example` 作为模板
2. 将实际的配置文件添加到 `.gitignore`
3. 在 Cloudflare Dashboard 中设置环境变量（推荐）

或者，使用 GitHub Secrets 存储敏感信息，然后在工作流中动态生成配置文件。
