<template>
  <NuxtLayout name="auth">
    <div class="register-container">
      <div class="header">
        <div class="logo">CF</div>
        <h1>{{ t('auth.registerTitle') }}</h1>
        <p class="subtitle">{{ t('auth.subtitle') }}</p>
      </div>

      <form @submit.prevent="handleSubmit" class="register-form">
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
          autocomplete="new-password"
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
          
          <div class="form-group">
            <label class="form-label">{{ t('auth.locale') }}</label>
            <div class="select-wrapper">
              <select v-model="form.locale" class="form-select" :disabled="loading">
                <option value="en">English</option>
                <option value="zh">简体中文</option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="message" class="alert" :class="{ 'alert-success': success, 'alert-error': !success }">
          {{ message }}
        </div>

        <UiButton type="submit" :loading="loading" block>
          {{ t('auth.submitRegister') }}
        </UiButton>

        <div class="form-footer">
          <p>
            Already have an account? 
            <NuxtLink to="/login" class="link">{{ t('auth.toLogin') }}</NuxtLink>
          </p>
        </div>
      </form>

      <div v-if="output" class="debug-tokens">
        <pre>{{ JSON.stringify(output, null, 2) }}</pre>
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
  locale: 'en',
})

const loading = ref(false)
const message = ref('')
const success = ref(false)
const output = ref<Record<string, unknown> | null>(null)

const handleSubmit = async () => {
  loading.value = true
  message.value = ''
  success.value = false
  try {
    const data = await $fetch(`${config.public.apiBase}/auth/register`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        tenant_id: form.tenantId,
        locale: form.locale,
      },
    })
    output.value = data as Record<string, unknown>
    message.value = t('auth.registered')
    success.value = true
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

.register-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.select-wrapper {
  position: relative;
}

.form-select {
  width: 100%;
  padding: 0.625rem 0.875rem;
  font-size: var(--font-size-sm);
  line-height: 1.25rem;
  color: var(--color-text-primary);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.5rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
}

.form-select:focus {
  outline: none;
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
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
