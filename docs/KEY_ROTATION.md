# 签名 key 轮换预案

`JWT_PRIVATE_KEY` 签发所有 access / id token。泄露意味着任何人都能伪造任意用户（包括管理员）登录所有接入应用，必须**立刻**轮换。

## 谁会受影响

| 校验方式 | 应用 | 轮换影响 |
| --- | --- | --- |
| 调 `/userinfo` | paste API、misonote-app | 无感（服务端用新 key 校验） |
| 拉 `/jwks.json` 按 `kid` 匹配 | agentparty、cherry（缓存 5 分钟）、blog 统计（缓存 1 小时） | 缓存过期前，新 token 校验失败；之后恢复 |
| 本服务自己 | 管理台、账号中心 | 旧 kid 的 token 立即失效（`verifyJwt` 要求 kid 等于当前 kid） |

Refresh token 是 D1 里的随机串，与签名 key 无关：换 key 后用户**不会**被登出，客户端刷新一次就拿到新 key 签的 token。

## 步骤

```bash
# 1. 生成新 key（放在仓库外）
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /secure/place/jwt-YYYY-MM.pem

# 2. 写成 secret（不要进 toml）
wrangler pages secret put JWT_PRIVATE_KEY --project-name cloudflare-sso < /secure/place/jwt-YYYY-MM.pem

# 3. 在 wrangler.account-prod.toml 把 JWT_KID 改成新值（例如 kYYYY-MM），然后部署
pnpm deploy:prod

# 4. 验证：kid 已变、模数已变
curl -s https://account.leeguoo.com/jwks.json
```

**泄露场景不做新旧 key 并存**：旧 key 已不可信，JWKS 只发布新 key。

## 记录

- 2026-10-02：`k2026-10` 替换 `primary`。原因：`primary` 私钥自 2025-12-02（提交 `89fd71a`，`wrangler.account-test.toml`）起存在于公开仓库的 git 历史中，并且一直通过 toml `[vars]` 下发到生产。
