<template>
  <NuxtLayout name="default">
    <div class="portal-page">
      <section class="card">
        <h2>My Session</h2>
        <p class="muted">Use your login cookie to refresh the current session and inspect profile claims.</p>
        <div class="actions">
          <button class="btn-primary" @click="refreshSession" :disabled="loading">
            {{ loading ? 'Loading...' : 'Refresh Session' }}
          </button>
          <button class="btn-secondary" @click="logout" :disabled="loading">
            Sign out
          </button>
        </div>
      </section>

      <section class="card" v-if="session">
        <h2>Token Snapshot</h2>
        <pre class="code">{{ JSON.stringify(session, null, 2) }}</pre>
      </section>

      <section class="card" v-if="error">
        <h2>Session Status</h2>
        <p class="error">{{ error }}</p>
      </section>

      <section class="card">
        <h2>Subscriptions</h2>
        <p class="muted">Billing center is prepared in admin module. Next step is connecting product/plan/subscription tables.</p>
        <NuxtLink class="inline-link" to="/admin/billing">Open Billing Console</NuxtLink>
      </section>
    </div>
  </NuxtLayout>
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
  gap: 1rem;
}

.card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.card h2 {
  font-size: 1rem;
  margin-bottom: 0.5rem;
}

.muted {
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.actions {
  display: flex;
  gap: 0.75rem;
}

.btn-primary,
.btn-secondary {
  border-radius: var(--radius-md);
  padding: 0.5rem 0.75rem;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.btn-primary {
  border: 1px solid var(--color-primary-600);
  background: var(--color-primary-600);
  color: white;
}

.btn-secondary {
  border: 1px solid var(--color-border);
  background: white;
  color: var(--color-text-primary);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.code {
  background: var(--color-neutral-100);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  overflow: auto;
  font-size: 0.75rem;
}

.error {
  color: #b91c1c;
}

.inline-link {
  font-weight: 600;
}
</style>
