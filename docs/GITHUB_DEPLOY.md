# GitHub Actions 部署指南

## 前置条件

1. 在 GitHub 仓库中设置以下 Secrets：
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API Token（需要 `Account.Cloudflare Pages:Edit` 权限）
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID（可以在 Cloudflare Dashboard 的右侧栏找到）

2. 在 Cloudflare Pages 项目中设置环境变量（通过 Dashboard 或 wrangler.toml）

## 获取 Cloudflare API Token

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 使用 "Edit Cloudflare Workers" 模板，或自定义权限：
   - `Account.Cloudflare Pages:Edit`
   - `Account.D1:Edit`
4. 复制生成的 Token 并添加到 GitHub Secrets

## 获取 Account ID

1. 访问 Cloudflare Dashboard
2. 在右侧栏可以看到 Account ID（格式：`3d050f54dac3fb90c344e3889ec45792`）

## 部署流程

### 自动部署

- **测试环境**: 推送到 `main` 或 `develop` 分支时自动部署
- **生产环境**: 推送 tag（格式：`v*`）时自动部署，或手动触发

### 手动部署

1. 在 GitHub 仓库中，点击 "Actions" 标签
2. 选择对应的工作流（Deploy to Test/Production）
3. 点击 "Run workflow"

## 环境变量配置

### 方式一：在 Cloudflare Pages Dashboard 中设置（推荐）

1. 访问 Cloudflare Dashboard → Pages → 你的项目
2. 进入 "Settings" → "Environment variables"
3. 添加以下变量：
   - `JWT_PRIVATE_KEY`: JWT 私钥（PKCS8 格式，多行）
   - `PASSWORD_PEPPER`: 密码加密盐值
   - `RECORDING_JWT_SECRET`: 录制 JWT 密钥
   - `JWT_ISSUER`: JWT 发行者 URL
   - 其他需要的环境变量

### 方式二：在配置文件中设置

如果需要在 `wrangler.account-*.toml` 中设置环境变量，请注意：
- 敏感信息（如 JWT_PRIVATE_KEY）不应该提交到 Git
- 可以使用 `wrangler.account-*.toml.example` 作为模板
- 实际的配置文件应该添加到 `.gitignore`（如果需要）

## 注意事项

- `wrangler.toml` 文件不会被提交到 Git（已在 .gitignore 中）
- 敏感配置应该通过 Cloudflare Dashboard 或 GitHub Secrets 管理
- 数据库配置（D1 database_id）需要在 `wrangler.account-*.toml` 中正确配置
- 如果配置文件包含敏感信息，考虑使用环境变量而不是配置文件
