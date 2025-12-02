<template>
  <div class="page">
    <div class="shell">
      <aside class="side">
        <div class="brand">
          <div class="logo">CF</div>
          <div>
            <p class="eyebrow">{{ t('landing.eyebrow') }}</p>
            <h1>{{ t('auth.loginTitle') }}</h1>
          </div>
        </div>
        <p class="lead">{{ t('auth.subtitle') }}</p>
        <div class="highlights">
          <div class="pill">OIDC · PKCE · RS256</div>
          <div class="pill">MFA Ready · Sessions with D1</div>
          <div class="pill">Cloudflare Pages + Workers</div>
        </div>
        <div class="stats">
          <div>
            <span class="stat-label">Uptime</span>
            <strong>99.95%</strong>
          </div>
          <div>
            <span class="stat-label">Regions</span>
            <strong>285 POPs</strong>
          </div>
          <div>
            <span class="stat-label">Latency</span>
            <strong>&lt;120ms</strong>
          </div>
        </div>
      </aside>

      <div class="panel">
        <div class="panel-header">
          <div class="badge">Single Sign-On</div>
          <p>{{ t('auth.subtitle') }}</p>
        </div>

        <form class="form" @submit.prevent="handleSubmit">
          <label>
            <span>{{ t('auth.email') }}</span>
            <input v-model="form.email" type="email" autocomplete="email" required />
          </label>
          <label>
            <span>{{ t('auth.password') }}</span>
            <input v-model="form.password" type="password" autocomplete="current-password" required />
          </label>
          <div class="row">
            <label>
              <span>{{ t('auth.tenant') }}</span>
              <input v-model="form.tenantId" autocomplete="organization" />
            </label>
            <label>
              <span>{{ t('auth.client') }}</span>
              <input v-model="form.clientId" autocomplete="off" />
            </label>
          </div>

          <button class="btn" type="submit" :disabled="loading">
            {{ loading ? t('common.loading') : t('auth.submitLogin') }}
          </button>
          <NuxtLink class="muted" to="/register">{{ t('auth.toRegister') }}</NuxtLink>
        </form>

        <div v-if="message" class="message" :class="{ success: success }">
          {{ message }}
        </div>

        <pre v-if="tokens" class="token-box">{{ JSON.stringify(tokens, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const config = useRuntimeConfig()

const form = reactive({
  email: 'demo@example.com',
  password: 'Passw0rd!',
  tenantId: 'tenant-demo',
  clientId: 'demo-web',
})

const tokens = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const message = ref('')
const success = ref(false)

const handleSubmit = async () => {
  loading.value = true
  message.value = ''
  success.value = false
  try {
    const data = await $fetch(`${config.public.apiBase}/auth/login`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        tenant_id: form.tenantId,
        client_id: form.clientId,
      },
    })
    tokens.value = data as Record<string, unknown>
    message.value = t('auth.success')
    success.value = true
    await navigateTo('/admin/access')
  } catch (err: any) {
    const detail = err?.data?.message || err?.message || 'Login failed'
    message.value = detail
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background-color: #f1f5f9; /* Slate 100 */
  color: #334155; /* Slate 700 */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.shell {
  width: 100%;
  max-width: 1000px;
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  background: #ffffff; /* White */
  border: 1px solid #e2e8f0; /* Slate 200 */
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

.side {
  padding: 3rem;
  background: #f8fafc; /* Slate 50 */
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: #2563eb; /* Blue 600 */
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1.1rem;
}

.eyebrow {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b; /* Slate 500 */
  margin-bottom: 0.25rem;
}

h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  color: #0f172a; /* Slate 900 */
}

.lead {
  color: #475569; /* Slate 600 */
  line-height: 1.6;
  font-size: 1rem;
  margin: 0;
}

.highlights {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pill {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  background: #e2e8f0; /* Slate 200 */
  color: #475569; /* Slate 600 */
  font-size: 0.8rem;
  font-weight: 500;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 1.5rem;
}

.stat-label {
  display: block;
  color: #64748b;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stats strong {
  font-size: 1.1rem;
  color: #0f172a;
}

.panel {
  padding: 3rem;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.panel-header {
  margin-bottom: 2rem;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  background: #eff6ff; /* Blue 50 */
  color: #2563eb; /* Blue 600 */
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.panel-header p {
  color: #64748b;
  margin: 0.5rem 0 0;
}

.form {
  display: grid;
  gap: 1.25rem;
}

label {
  display: block;
}

label span {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
  margin-bottom: 0.5rem;
}

input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  border: 1px solid #cbd5e1; /* Slate 300 */
  background: #ffffff;
  color: #0f172a;
  font-size: 0.95rem;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}

input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.btn {
  width: 100%;
  padding: 0.75rem;
  border-radius: 6px;
  border: none;
  background: #2563eb; /* Blue 600 */
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: #1d4ed8; /* Blue 700 */
}

.btn:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
}

.muted {
  display: inline-block;
  margin-top: 1rem;
  color: #64748b;
  font-size: 0.875rem;
  text-decoration: none;
}

.muted:hover {
  color: #475569;
}

.message {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 6px;
  background: #fef2f2; /* Red 50 */
  border: 1px solid #fee2e2; /* Red 200 */
  color: #b91c1c; /* Red 700 */
  font-size: 0.875rem;
}

.message.success {
  background: #f0fdf4; /* Green 50 */
  border-color: #dcfce7; /* Green 200 */
  color: #15803d; /* Green 700 */
}

.token-box {
  margin-top: 1.5rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 1rem;
  color: #334155;
  font-size: 0.8rem;
  overflow-x: auto;
}

@media (max-width: 768px) {
  .shell {
    grid-template-columns: 1fr;
  }
  .side {
    display: none;
  }
  .panel {
    padding: 2rem;
  }
}
</style>
