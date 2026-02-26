<template>
  <div class="legal-page">
    <UiCard class="legal-card">
      <h1>关于平台</h1>
      <p>leeguoo Identity 是面向多应用统一身份的统一登录与账号管理入口。</p>
      <ul>
        <li>当前版本为第一阶段：账户中心导航、统一身份鉴权、基础订阅能力已接入。</li>
        <li>当前目标：提升跨应用账号一致性并统一安全策略与会话模型。</li>
        <li>未来版本将持续补齐密码、第三方关联、权限与订阅运营管理能力。</li>
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
  width: min(820px, 95%);
  padding: 20px;
}

.legal-back-link {
  display: inline-block;
  margin-top: 12px;
}

.legal-card ul {
  margin: 14px 0 0 0;
  padding-left: 18px;
}

.legal-card li {
  margin: 6px 0;
}
</style>
