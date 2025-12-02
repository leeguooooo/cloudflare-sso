# 部署指南

## 前置条件
1. 安装 `pnpm`、`wrangler`（已在 devDependencies 中）
2. 可访问的 Cloudflare 账号（测试 / 生产）
3. 已创建 D1 数据库，并在 `wrangler.account-*.toml` 中写入对应 `database_id`

## 流程
```bash
pnpm install
pnpm wrangler:config:test  # 或 prod
pnpm deploy:test           # 构建并部署到 Cloudflare Pages
```

`wrangler:config:*` 会把对应账号的 `wrangler.account-*.toml` 复制为根目录的 `wrangler.toml`，因为 Pages 只能读取默认配置文件。默认部署目录为 `.output/public`（Nuxt 4 + Cloudflare Pages 的产物）。

## 查看 Cloudflare Pages 日志
```bash
pnpm logs:test   # 预览/测试账号
pnpm logs:prod   # 生产账号
```

脚本会自动切换 Wrangler 配置并调用 `wrangler pages deployment tail`，默认 `--project-name` 为 `cf-nuxt-pages-kit`，记得替换成你自己的 Pages 项目名称。

## 常见问题
- **找不到数据库**：确认 `wrangler.account-*.toml` 内的 `database_id` 指向当前账号下存在的 D1。
- **部署目录错误**：模板使用 `.output/public` 作为输出路径；如果改成别的目录，记得同步 `wrangler.account-*.toml` 与部署脚本。
- **多账号切换**：再次运行 `pnpm wrangler:config:<env>` 即可覆盖 `wrangler.toml`。
