<template>
  <div class="legal-page">
    <UiCard class="legal-card">
      <h1>隐私权</h1>
      <p>以下为当前版本的隐私说明页占位内容，用于展示公开页面可访问入口。</p>
      <ul>
        <li>我们会根据服务协议及隐私政策收集并保护必要账号信息。</li>
        <li>账号状态、登录方式与授权信息仅用于身份服务与安全审计。</li>
        <li>后续版本将补充详细字段级隐私条款与导出、删除流程说明。</li>
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
