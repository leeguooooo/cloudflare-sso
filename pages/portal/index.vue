<template>
  <div class="portal-page">
    <UiCard
      class="info-card"
      title="My Session"
      subtitle="Use your login cookie to refresh the current session and inspect profile claims."
    >
      <div class="card-actions">
        <UiButton variant="primary" :loading="loading" @click="refreshSession">
          Refresh Session
        </UiButton>
        <UiButton variant="outline" :disabled="loading" @click="logout">
          Sign out
        </UiButton>
      </div>
    </UiCard>

    <UiCard v-if="session" class="info-card wide-card" title="Token Snapshot">
      <div class="code-wrapper">
        <pre class="code">{{ JSON.stringify(session, null, 2) }}</pre>
      </div>
    </UiCard>

    <UiCard v-if="error" class="info-card" title="Session Status">
      <UiAlert variant="danger" :message="error" />
    </UiCard>

    <UiCard
      class="info-card"
      title="Subscriptions"
      subtitle="Billing schema is ready in SSO. Next step is entitlement read APIs and event ingestion."
    >
      <template #footer>
        <NuxtLink class="card-link" to="/admin/billing">Open Billing Console</NuxtLink>
      </template>
    </UiCard>
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
}
</style>
