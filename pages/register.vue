<template>
  <div class="register-container">
    <div class="header">
      <h1>Create an Identity Account</h1>
      <p class="subtitle">Enter your details to get started</p>
    </div>

    <div class="oauth-section">
      <button class="oauth-btn" type="button" :disabled="loading" @click="startSocialSignup('google')">
        Continue with Google
      </button>
      <button class="oauth-btn" type="button" :disabled="loading" @click="startSocialSignup('github')">
        Continue with GitHub
      </button>
      <button class="oauth-btn oauth-btn-disabled" type="button" disabled title="Coming soon">
        WeChat (planned)
      </button>
    </div>

    <div class="oauth-divider">Or create with email</div>

    <form @submit.prevent="handleSubmit" class="register-form">
      <UiInput
        v-model="form.email"
        type="email"
        label="Email address"
        autocomplete="email"
        required
        :disabled="loading"
      />

      <UiInput
        v-model="form.password"
        type="password"
        label="Password"
        autocomplete="new-password"
        required
        :disabled="loading"
      />

      <div v-if="message" class="alert" :class="{ 'alert-success': success, 'alert-error': !success }">
        {{ message }}
      </div>

      <div class="form-actions">
        <NuxtLink :to="loginPath" class="btn-link">
          Sign in instead
        </NuxtLink>
        <UiButton type="submit" variant="primary" :loading="loading">
          Next
        </UiButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const config = useRuntimeConfig()
const route = useRoute()
const { locale } = useI18n()
const loading = ref(false)
const message = ref('')
const success = ref(false)
type SocialProvider = 'google' | 'github'

const form = reactive({
  email: 'demo@example.com',
  password: 'Passw0rd!',
})

const resolveContinuePath = () => {
  const raw = typeof route.query.continue === 'string' ? route.query.continue : ''
  if (!raw.startsWith('/')) return ''
  if (raw.startsWith('//')) return ''
  return raw
}

const buildLoginPath = (options?: { prefillEmail?: string; registered?: boolean }) => {
  const query = new URLSearchParams()
  const clientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (clientId) {
    query.set('client_id', clientId)
  }
  const continuePath = resolveContinuePath()
  if (continuePath) {
    query.set('continue', continuePath)
  }
  if (options?.prefillEmail) {
    query.set('email', options.prefillEmail)
  }
  if (options?.registered) {
    query.set('registered', '1')
  }
  const queryString = query.toString()
  return queryString ? `/login?${queryString}` : '/login'
}

const loginPath = computed(() => {
  return buildLoginPath()
})

const resolveClientId = () => {
  const queryClientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (queryClientId) return queryClientId

  const continuePath = typeof route.query.continue === 'string' ? route.query.continue : ''
  if (continuePath.startsWith('/authorize?')) {
    const params = new URLSearchParams(continuePath.split('?')[1] || '')
    const continueClientId = params.get('client_id') || ''
    if (continueClientId) return continueClientId
  }

  const configuredDefault = typeof config.public.defaultClientId === 'string' ? config.public.defaultClientId.trim() : ''
  if (configuredDefault) return configuredDefault

  const hostname = process.client ? window.location.hostname.toLowerCase() : ''
  if (hostname === 'account.misonote.com' || hostname.endsWith('.misonote.com')) {
    return 'misonote-app-web'
  }
  return 'demo-web'
}

const handleSubmit = async () => {
  loading.value = true
  message.value = ''
  success.value = false
  try {
    const clientId = resolveClientId()

    await $fetch(`${config.public.apiBase}/auth/register`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        client_id: clientId,
        locale: typeof locale.value === 'string' ? locale.value : 'en',
      },
    })
    if (process.client) {
      localStorage.setItem('sso_last_email', form.email)
    }
    await navigateTo(buildLoginPath({ prefillEmail: form.email, registered: true }))
  } catch (err: any) {
    const detail = err?.data?.message || err?.message || 'Registration failed'
    message.value = detail
    success.value = false
  } finally {
    loading.value = false
  }
}

const startSocialSignup = (provider: SocialProvider) => {
  if (!process.client || loading.value) return

  const clientId = resolveClientId()
  if (!clientId) {
    message.value = 'Missing client_id'
    success.value = false
    return
  }

  const query = new URLSearchParams()
  query.set('provider', provider)
  query.set('client_id', clientId)
  const continuePath = resolveContinuePath()
  if (continuePath) {
    query.set('continue', continuePath)
  }

  window.location.href = `${config.public.apiBase}/auth/oauth/start?${query.toString()}`
}
</script>

<style scoped>
.register-container {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  margin-bottom: 24px;
}

.header h1 {
  font-size: 2.25rem;
  font-weight: 400;
  line-height: 2.75rem;
  margin-bottom: 8px;
  color: #1f1f1f;
}

.subtitle {
  color: #444746;
  font-size: 1rem;
  line-height: 1.5rem;
}

.oauth-section {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.oauth-btn {
  min-width: 170px;
  height: 42px;
  border: 1px solid #dadce0;
  border-radius: 999px;
  background: #fff;
  color: #1f1f1f;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0 16px;
  transition: background-color 0.2s;
}

.oauth-btn:hover:not(:disabled) {
  background: #f7f9fc;
}

.oauth-btn-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.oauth-divider {
  margin-bottom: 12px;
  color: #5f6368;
  font-size: 0.8125rem;
}

.register-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
}

.btn-link {
  color: var(--color-primary-600);
  font-weight: 500;
  font-size: 0.875rem;
  text-decoration: none;
  padding: 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.btn-link:hover {
  background-color: #f7f9fc;
}

.alert {
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  margin-top: 8px;
}

.alert-error {
  background-color: #fce8e6;
  color: #d93025;
}

.alert-success {
  background-color: #e6f4ea;
  color: #137333;
}

</style>
