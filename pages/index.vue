<template>
  <div class="landing">
    <div class="hero">
      <UiLogo size="lg" mode="full" />
      <p>One account. All of leeguoo Identity working for you.</p>
    </div>

    <div class="actions">
      <NuxtLink class="action-card-link" to="/account">
        <UiCard class="action-card">
          <div class="card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21a8 8 0 1 0-16 0" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div class="card-content">
            <h2>Account Center</h2>
            <p>Manage your login, security, and personal info in one place.</p>
          </div>
        </UiCard>
      </NuxtLink>

      <NuxtLink class="action-card-link" to="/admin">
        <UiCard class="action-card">
          <div class="card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </div>
          <div class="card-content">
            <h2>Admin Console</h2>
            <p>Configure clients, roles, and manage billing entitlements.</p>
          </div>
        </UiCard>
      </NuxtLink>
    </div>

    <div class="auth-cta">
      <UiButton variant="primary" to="/login">Sign in</UiButton>
      <UiButton variant="ghost" to="/register">Create account</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

type RefreshPayload = {
  access_token?: string
}

const config = useRuntimeConfig()

const tryResumeSession = async () => {
  let token = localStorage.getItem('sso_access_token') || ''
  if (!token) {
    try {
      const refreshData = await $fetch<RefreshPayload>(`${config.public.apiBase}/auth/refresh`, {
        method: 'POST',
        body: {},
      })
      token = refreshData?.access_token || ''
      if (token) {
        localStorage.setItem('sso_access_token', token)
      }
    } catch {
      token = ''
    }
  }
  return !!token
}

onMounted(async () => {
  if (!process.client) return
  const token = await tryResumeSession()
  if (token) {
    await navigateTo('/account')
  }
})
</script>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero {
  text-align: center;
}

.hero p {
  color: #444746;
  font-size: 1rem;
  line-height: 1.5rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card-link {
  text-decoration: none;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 16px;
  transition: background-color 0.2s;
}

.action-card:hover {
  background-color: #f7f9fc;
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #e8f0fe;
  color: #1a73e8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-content h2 {
  font-size: 1rem;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 4px;
}

.card-content p {
  color: #444746;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.auth-cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
}
</style>
