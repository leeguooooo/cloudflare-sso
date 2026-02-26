<template>
  <div class="portal-page">
    <section class="info-card">
      <div class="card-header">
        <h2>My Session</h2>
      </div>
      <p class="card-desc">Use your login cookie to refresh the current session and inspect profile claims.</p>
      <div class="card-actions">
        <UiButton variant="primary" :loading="loading" @click="refreshSession">
          Refresh Session
        </UiButton>
        <UiButton variant="outline" :disabled="loading" @click="logout">
          Sign out
        </UiButton>
      </div>
    </section>

    <section v-if="session" class="info-card wide-card">
      <div class="card-header">
        <h2>Token Snapshot</h2>
      </div>
      <div class="code-wrapper">
        <pre class="code">{{ JSON.stringify(session, null, 2) }}</pre>
      </div>
    </section>

    <section v-if="error" class="info-card">
      <div class="card-header">
        <h2 class="error-title">Session Status</h2>
      </div>
      <p class="error-message">{{ error }}</p>
    </section>

    <section class="info-card">
      <div class="card-header">
        <h2>Subscriptions</h2>
      </div>
      <p class="card-desc">Billing schema is ready in SSO. Next step is entitlement read APIs and event ingestion.</p>
      <div class="card-footer-link">
        <NuxtLink class="card-link" to="/admin/billing">Open Billing Console</NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
type RefreshPayload = {
  token_type: string
  access_token: string
  id_token: string
  refresh_token: string
  expires_in: number
}

const config = useRuntimeConfig()
const session = ref<RefreshPayload | null>(null)
const error = ref('')
const loading = ref(false)

const refreshSession = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<RefreshPayload>(`${config.public.apiBase}/auth/refresh`, {
      method: 'POST',
      body: {},
    })
    session.value = data
    if (process.client && data.access_token) {
      localStorage.setItem('sso_access_token', data.access_token)
    }
  } catch (err: any) {
    const detail = err?.data?.statusMessage || err?.data?.message || err?.message || 'Refresh session failed'
    error.value = detail
    session.value = null
  } finally {
    loading.value = false
  }
}

const logout = async () => {
  loading.value = true
  error.value = ''
  try {
    await $fetch(`${config.public.apiBase}/auth/logout`, {
      method: 'POST',
      body: {},
    })
    if (process.client) {
      localStorage.removeItem('sso_access_token')
    }
    session.value = null
    await navigateTo('/login')
  } catch (err: any) {
    const detail = err?.data?.statusMessage || err?.data?.message || err?.message || 'Logout failed'
    error.value = detail
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.portal-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.info-card {
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.wide-card {
  grid-column: span 2;
}

.card-header h2 {
  font-size: 1.375rem;
  font-weight: 400;
  color: #1f1f1f;
  margin-bottom: 16px;
}

.card-desc {
  font-size: 0.875rem;
  color: #444746;
  line-height: 1.5rem;
  margin-bottom: 24px;
  flex: 1;
}

.card-actions {
  display: flex;
  gap: 12px;
}

.code-wrapper {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  overflow: auto;
}

.code {
  font-family: 'Roboto Mono', monospace;
  font-size: 0.75rem;
  margin: 0;
  color: #1f1f1f;
}

.error-title {
  color: #d93025;
}

.error-message {
  color: #d93025;
  font-size: 0.875rem;
}

.card-footer-link {
  margin-top: auto;
  padding-top: 16px;
}

.card-link {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1a73e8;
  text-decoration: none;
}

.card-link:hover {
  text-decoration: underline;
}

@media (max-width: 800px) {
  .portal-page {
    grid-template-columns: 1fr;
  }
  .wide-card {
    grid-column: span 1;
  }
}
</style>
