<template>
  <div class="legal-page">
    <UiCard class="legal-card">
      <h1>关于 leeguoo Identity</h1>
      <p>leeguoo Identity 是面向多应用的统一身份与授权入口。</p>

      <h2>当前能力</h2>
      <ul>
        <li>邮箱密码登录、Google/GitHub 第三方登录入口（WeChat 记为 TODO）。</li>
        <li>统一账号中心：资料管理、密码变更、会话管理、第三方绑定。</li>
        <li>多租户角色权限模型与订阅权益联动。</li>
      </ul>

      <h2>设计目标</h2>
      <ul>
        <li>一个全局账号贯通多个应用租户，减少重复注册和重复登录。</li>
        <li>通过统一会话、审计与权限模型提升安全与运维效率。</li>
        <li>通过标准 OAuth/OIDC 接口降低业务系统接入成本。</li>
      </ul>

      <h2>版本信息</h2>
      <ul>
        <li>站点版本：Identity Program 2026Q1</li>
        <li>最后更新：2026-03-03</li>
      </ul>

      <NuxtLink to="/account" class="legal-back-link">返回账号中心</NuxtLink>
    </UiCard>
  </div>
</template>

<style scoped>
.legal-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--color-background);
  padding: 32px 16px;
}

.legal-card {
  width: min(860px, 95%);
  padding: 24px;
}

.legal-card h2 {
  margin: 18px 0 8px;
  font-size: 1rem;
}

.legal-card ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

.legal-card li {
  margin: 6px 0;
}

.legal-back-link {
  display: inline-block;
  margin-top: 14px;
}
</style>
