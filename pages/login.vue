<template>
  <NuxtLayout name="auth">
    <div class="login-container">
      <div class="header">
        <div class="logo">CF</div>
        <h1>{{ t('auth.loginTitle') }}</h1>
        <p class="subtitle">{{ t('auth.subtitle') }}</p>
      </div>

      <form @submit.prevent="handleSubmit" class="login-form">
        <UiInput
          v-model="form.email"
          type="email"
          :label="t('auth.email')"
          autocomplete="email"
          required
          :disabled="loading"
        />
        
        <UiInput
          v-model="form.password"
          type="password"
          :label="t('auth.password')"
          autocomplete="current-password"
          required
          :disabled="loading"
        />

        <div class="form-row">
          <UiInput
            v-model="form.tenantId"
            :label="t('auth.tenant')"
            autocomplete="organization"
            :disabled="loading"
          />
          <UiInput
            v-model="form.clientId"
            :label="t('auth.client')"
            autocomplete="off"
            :disabled="loading"
          />
        </div>

        <div v-if="message" class="alert" :class="{ 'alert-success': success, 'alert-error': !success }">
          {{ message }}
        </div>

        <UiButton type="submit" :loading="loading" block>
          {{ t('auth.submitLogin') }}
        </UiButton>

        <div class="form-footer">
          <p>
            Don't have an account? 
            <NuxtLink to="/register" class="link">{{ t('auth.toRegister') }}</NuxtLink>
          </p>
        </div>
      </form>

      <div v-if="tokens" class="debug-tokens">
        <pre>{{ JSON.stringify(tokens, null, 2) }}</pre>
      </div>
    </div>
  </NuxtLayout>
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
.login-container {
  width: 100%;
}

.header {
  text-align: center;
  margin-bottom: 2rem;
}

.logo {
  width: 48px;
  height: 48px;
  background-color: var(--color-primary-600);
  color: white;
  border-radius: var(--radius-lg);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1.25rem;
  margin: 0 auto 1.5rem;
}

h1 {
  font-size: 1.875rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-primary);
}

.subtitle {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-footer {
  text-align: center;
  margin-top: 1rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.link {
  color: var(--color-primary-600);
  font-weight: 500;
}

.link:hover {
  text-decoration: underline;
}

.alert {
  padding: 0.75rem;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  margin-bottom: 0.5rem;
}

.alert-error {
  background-color: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fee2e2;
}

.alert-success {
  background-color: #f0fdf4;
  color: #15803d;
  border: 1px solid #dcfce7;
}

.debug-tokens {
  margin-top: 2rem;
  padding: 1rem;
  background-color: var(--color-neutral-100);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  overflow-x: auto;
}
</style>
