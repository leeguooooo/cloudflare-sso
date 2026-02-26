<template>
  <div class="legal-page">
    <UiCard class="legal-card">
      <h1>帮助中心</h1>
      <p>支持常见问题说明与联系入口，当前先做公开说明页，后续接入工单系统。</p>
      <ul>
        <li>登录问题：优先确认账号已完成邮箱登录与全局凭据同步。</li>
        <li>账号中心：使用左侧导航切换“安全、密码、隐私、订阅”等信息模块。</li>
        <li>登出问题：点击“退出登录”并重新执行授权流程。</li>
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
