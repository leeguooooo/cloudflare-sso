# SSO 项目化启动说明

## 目标
- 独立身份项目，不再散落在各业务应用中重复实现登录逻辑。
- 同时具备：
  - 用户前台（Portal）：登录后会话与账户视图。
  - 管理后台（Admin）：客户端、权限、订阅/权益管理入口。

## 当前结构
- `pages/portal/*`：用户前台
- `pages/admin/*`：管理后台
- `server/routes/api/auth/*`：登录注册与令牌刷新
- `server/routes/api/access/*`：RBAC 管理
- `server/routes/api/admin/*`：后台总览与客户端列表接口

## 路由入口
- `/`：平台入口页（Portal/Admin 导航）
- `/portal`：用户前台
- `/admin`：后台总览
- `/admin/access`：角色权限管理
- `/admin/apps`：OIDC 客户端管理
- `/admin/billing`：订阅/权益管理入口

## 下一步（按顺序）
1. 接入 billing 服务表（products/plans/subscriptions/entitlements）。
2. 为 `/api/admin/*` 增加管理员鉴权中间件（JWT role/perms）。
3. 在 `/portal` 接入 entitlement 查询接口，显示真实订阅状态。
4. 对接 `blog` 与 `paste` 的 OIDC client，并下线各自本地账号体系。
