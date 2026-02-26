<template>
  <div class="legal-page">
    <UiCard class="legal-card">
      <h1>服务条款</h1>
      <p>当前是统一身份平台阶段性条款页面，先提供版本级说明与使用边界。</p>
      <ul>
        <li>账号与身份体系作为平台统一入口，支持跨应用登录与租户映射。</li>
        <li>账户数据仅用于登录、授权、审计与服务可用性保障。</li>
        <li>具体数据保存周期与合规说明将在正式版同步更新。</li>
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
