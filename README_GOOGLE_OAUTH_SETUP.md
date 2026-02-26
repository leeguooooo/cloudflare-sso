# Google OAuth 快捷登录设置（本项目）

## 已配置项
- OAuth Client ID: `9266088847-8oauoaula4i2shtmt3pnlt9av22p0e8h.apps.googleusercontent.com`
- 回调 URI（需与 Google 控制台保持一致）：
  - `https://account.misonote.com/api/auth/oauth/callback?provider=google`
  - `http://localhost:3000/api/auth/oauth/callback?provider=google`

## 我已帮你写入
- `/Users/leo/github.com/cloudflare-sso/.env.local`
  - `OAUTH_GOOGLE_CLIENT_ID`
  - `OAUTH_GOOGLE_REDIRECT_URI`（开发）
  - `OAUTH_GOOGLE_CLIENT_SECRET`（请填入真实值）
- `/Users/leo/github.com/cloudflare-sso/wrangler.account-prod.toml`
  - `OAUTH_GOOGLE_CLIENT_ID`
  - `OAUTH_GOOGLE_REDIRECT_URI`

## 你还需要做的一步（最关键）
在 `OAUTH_GOOGLE_CLIENT_SECRET` 处填写 Secret：
- `.env.local` 本地开发填写
- 或 Cloudflare Pages Dashboard 设为环境变量（建议）

## 注意
- 若 Google OAuth 仍报“只有测试用户有权限”，请在 `OAuth consent screen` 的 `Test users` 中加上你的测试账号，或完成生产审核后再放开。
