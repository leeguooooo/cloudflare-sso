# Wrangler 多账号指南

- 模板内置 `wrangler.account-test.toml` 与 `wrangler.account-prod.toml`
- `pnpm wrangler:config:test|prod` 会把对应文件复制为 `wrangler.toml`
- 新账号时，复制一份 `wrangler.account-test.toml`，更改 `database_id`、变量，再在 `package.json` 增加同名脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm wrangler:config:test` | 切换到测试账号配置 |
| `pnpm wrangler:config:prod` | 切换到生产账号配置 |
| `pnpm deploy:test` | build + deploy 到测试 Pages 项目 |
| `pnpm deploy:prod` | build + deploy 到生产 Pages 项目 |

## 配置模板
```toml
name = "cloudflare-sso"
compatibility_date = "2024-12-01"
pages_build_output_dir = ".output/public"

[vars]
CDN_BASE_URL = "https://cdn.example.com"
RECORDING_JWT_SECRET = "<replace-me>"

[[d1_databases]]
binding = "DB"
database_name = "cf-nuxt-pages-db"
database_id = "<your-d1-id>"
```

> Cloudflare Pages 只能读取工作目录下的 `wrangler.toml`，因此必须使用复制的方式而不是 `wrangler --config`。
