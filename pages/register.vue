<template>
  <div class="register-container">
    <div class="header">
      <h1>Create an Identity Account</h1>
      <p class="subtitle">Enter your details to get started</p>
    </div>

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
        <NuxtLink to="/login" class="btn-link">
          Sign in instead
        </NuxtLink>
        <UiButton type="submit" variant="primary" :loading="loading">
          Next
        </UiButton>
      </div>
    </form>

    <div v-if="output" class="debug-tokens">
      <pre>{{ JSON.stringify(output, null, 2) }}</pre>
    </div>
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
const output = ref<Record<string, unknown> | null>(null)

const form = reactive({
  email: 'demo@example.com',
  password: 'Passw0rd!',
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
  return configuredDefault || 'demo-web'
}

const handleSubmit = async () => {
  loading.value = true
  message.value = ''
  success.value = false
  try {
    const clientId = resolveClientId()
    if (!clientId) {
      throw new Error('Missing client_id')
    }

    const data = await $fetch(`${config.public.apiBase}/auth/register`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        client_id: clientId,
        locale: typeof locale.value === 'string' ? locale.value : 'en',
      },
    })
    output.value = data as Record<string, unknown>
    message.value = 'Account created successfully. You can now sign in.'
    success.value = true
    if (process.client) {
      localStorage.setItem('sso_last_email', form.email)
    }
  } catch (err: any) {
    const detail = err?.data?.message || err?.message || 'Registration failed'
    message.value = detail
  } finally {
    loading.value = false
  }
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

.debug-tokens {
  margin-top: 24px;
  padding: 12px;
  background-color: #f1f3f4;
  border-radius: 4px;
  font-size: 0.75rem;
  overflow-x: auto;
}
</style>
