<template>
  <div class="dev-page">
    <header class="dev-header">
      <NuxtLink to="/" class="brand">leeguoo 账号 · 开发者</NuxtLink>
      <nav class="toc">
        <a v-for="item in toc" :key="item.id" :href="`#${item.id}`">{{ item.label }}</a>
      </nav>
    </header>

    <main class="dev-main">
      <h1>接入 leeguoo 账号</h1>
      <p class="lead">
        所有 App 共用一个账号体系：用户在 <code>{{ issuer }}</code> 登录一次，就能进入每个接入的 App。你的 App 不用自己存密码、做找回、做两步验证。
      </p>

      <section id="register">
        <h2>1. 开通 App</h2>
        <p>平台管理员在后台「Applications」为你的 App 建租户和 client（或调 <code>POST /api/admin/apps/bootstrap</code>）。每个端单独一个 <code>client_id</code>：Web、iOS、macOS、后端服务分开。</p>
        <ul>
          <li>浏览器和原生 App：public client，授权码 + PKCE（S256，必填）。</li>
          <li>后端服务：机密 client，<code>client_credentials</code> + 业务 scope，例如 <code>billing:entitlements.read</code>。</li>
        </ul>
      </section>

      <section id="login">
        <h2>2. 登录（OIDC）</h2>
        <p>发现文档：<a :href="`${issuer}/.well-known/openid-configuration`">{{ issuer }}/.well-known/openid-configuration</a>。用任何标准 OIDC 库即可。</p>
        <pre><code>GET {{ issuer }}/authorize?response_type=code&amp;client_id=&lt;id&gt;&amp;redirect_uri=&lt;uri&gt;
    &amp;scope=openid%20profile%20email&amp;state=&lt;state&gt;&amp;nonce=&lt;nonce&gt;
    &amp;code_challenge=&lt;S256(verifier)&gt;&amp;code_challenge_method=S256

POST {{ issuer }}/token
  grant_type=authorization_code&amp;code=…&amp;redirect_uri=…&amp;client_id=…&amp;code_verifier=…</code></pre>
        <ul>
          <li>Refresh token 每次刷新都会换新；旧的在 30 秒后再用视为重放，整个会话失效。</li>
          <li>退出：<code>GET /logout?id_token_hint=…&amp;post_logout_redirect_uri=…</code>，或 <code>POST /revoke</code>。</li>
          <li>电视等不方便输入的设备：设备授权 <code>POST /device/code</code>（RFC 8628）。</li>
          <li>App 内原生「通过 Apple 登录」：<code>POST /api/auth/apple/native</code>；微信小程序：<code>POST /api/auth/wechat/miniprogram</code>。</li>
        </ul>
      </section>

      <section id="claims">
        <h2>3. 认哪个用户</h2>
        <p>用 <code>/jwks.json</code> 按 <code>kid</code> 验签 access token（遇到未知 <code>kid</code> 重新拉取），然后只认这些 claim：</p>
        <table>
          <thead><tr><th>claim</th><th>含义</th></tr></thead>
          <tbody>
            <tr><td><code>sub</code></td><td>这个人在你的 App（租户）里的 id，作为你表里的用户主键</td></tr>
            <tr><td><code>tid</code></td><td>租户，必须是你的</td></tr>
            <tr><td><code>aud</code></td><td>client，必须是你的</td></tr>
            <tr><td><code>gaid</code></td><td>全局账号 id，跨 App 关联用，不要当主键</td></tr>
            <tr><td><code>roles</code> / <code>perms</code></td><td>该租户里的角色和权限</td></tr>
            <tr><td><code>sid</code></td><td>会话；要立刻感知退出就调 <code>/userinfo</code></td></tr>
          </tbody>
        </table>
      </section>

      <section id="entitlements">
        <h2>4. 付费功能</h2>
        <p>判断「这个用户现在能不能用某功能」统一走：</p>
        <pre><code>GET {{ issuer }}/api/billing/entitlements/check?entitlement_key=&lt;key&gt;
Authorization: Bearer &lt;用户的 access token，或带 billing:entitlements.read 的服务 token + &amp;user_id=&gt;

→ { "allowed": true, "source": "plan", "trial": false, "valid_to": 1793000000 }</code></pre>
        <p>每次回答都会按 App 统计，后台首页能看到拒绝率；拒绝率突然升高通常是账单同步或 key 改名出了问题。</p>
      </section>

      <section id="webhooks">
        <h2>5. Webhook</h2>
        <p>在后台「Webhooks」登记 https 地址，用户被停用、删除、合并、全部登出、两步验证被重置或会员变化时会收到通知。用创建时给的密钥校验：</p>
        <pre><code>// Node / Workers
const [t, v1] = header('x-leeguoo-signature').split(',').map((p) =&gt; p.split('=')[1])
if (Math.abs(Date.now() / 1000 - Number(t)) &gt; 300) reject()
const mac = hmacSha256Hex(secret, `${t}.${rawBody}`)
if (!timingSafeEqual(mac, v1)) reject()
// 按 x-leeguoo-delivery 去重：失败重试会用同一个 id</code></pre>
        <p>请求体：<code>{ id, type, created, tenant_id, data: { sub, global_account_id, … } }</code>。返回 2xx 即成功，否则在 5 分钟到 24 小时内自动重试。</p>
      </section>

      <section id="migration">
        <h2>6. 迁移老用户</h2>
        <p>App 以前有自己的用户表时，用后台「Migrations」（或 <code>POST /api/admin/identity-mappings/import</code>）把老用户映射到 SSO 账号，先 dry run。只有旧系统验证过的邮箱会自动关联，其余标为需要人工确认。之后用老 id 查新 <code>sub</code>：</p>
        <pre><code>GET {{ issuer }}/api/admin/identity-mappings?tenant_id=…&amp;source_system=paste&amp;source_user_id=1024
Authorization: Bearer &lt;带 identity:mappings.read 的服务 token&gt;</code></pre>
        <p>旧的登录方式下线前，后端定期把命中次数报给 <code>POST /api/metrics/legacy-auth</code>；连续 7 天低于 0.1% 时后台会标为可以删除。</p>
      </section>

      <section id="support">
        <h2>7. 用户那一侧</h2>
        <p>用户在 <NuxtLink to="/account">账号中心</NuxtLink> 管理资料、密码、通行密钥、两步验证、登录过的设备、已授权的 App 和会员。你的 App 里放一个「管理账号」链接到这里即可。</p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: '接入 leeguoo 账号 · 开发者' })

const issuer = computed(() => (process.client ? window.location.origin : 'https://account.leeguoo.com'))

const toc = [
  { id: 'register', label: '开通' },
  { id: 'login', label: '登录' },
  { id: 'claims', label: '用户标识' },
  { id: 'entitlements', label: '付费' },
  { id: 'webhooks', label: 'Webhook' },
  { id: 'migration', label: '迁移' },
  { id: 'support', label: '账号中心' },
]
</script>

<style scoped>
.dev-page {
  min-height: 100vh;
  background: var(--color-background, #fffdf7);
  color: var(--color-text-primary, #1f1f1f);
  font-family: var(--font-family-sans, system-ui, sans-serif);
}

.dev-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 14px 24px;
  background: var(--color-surface, #fff);
  border-bottom: 1px solid var(--color-border-subtle, #e8eaed);
}

.brand {
  font-weight: 700;
  color: inherit;
  text-decoration: none;
}

.toc {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 14px;
}

.toc a {
  color: var(--color-text-secondary, #5f6368);
  text-decoration: none;
}

.toc a:hover {
  color: var(--color-primary-600, #1a73e8);
}

.dev-main {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 16px 80px;
  line-height: 1.7;
}

h1 {
  font-size: 30px;
  margin: 0 0 8px;
}

.lead {
  font-size: 16px;
  color: var(--color-text-secondary, #5f6368);
}

section {
  margin-top: 36px;
  scroll-margin-top: 72px;
}

h2 {
  font-size: 20px;
  margin: 0 0 8px;
}

pre {
  overflow-x: auto;
  background: #1f2328;
  color: #e6edf3;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

p code,
li code,
td code {
  background: var(--color-surface-muted, #f1f3f4);
  padding: 1px 5px;
  border-radius: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-subtle, #e8eaed);
  vertical-align: top;
}

a {
  color: var(--color-primary-600, #1a73e8);
}
</style>
