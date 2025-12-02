<template>
  <div class="page">
    <div class="card">
      <div class="header">
        <p class="eyebrow">{{ t('landing.eyebrow') }}</p>
        <h1>{{ t('auth.registerTitle') }}</h1>
        <p class="subtext">{{ t('auth.subtitle') }}</p>
      </div>

      <form class="form" @submit.prevent="handleSubmit">
        <label>
          <span>{{ t('auth.email') }}</span>
          <input v-model="form.email" type="email" autocomplete="email" required />
        </label>
        <label>
          <span>{{ t('auth.password') }}</span>
          <input v-model="form.password" type="password" autocomplete="new-password" required />
        </label>
        <label>
          <span>{{ t('auth.tenant') }}</span>
          <input v-model="form.tenantId" autocomplete="organization" />
        </label>
        <label>
          <span>{{ t('auth.locale') }}</span>
          <select v-model="form.locale">
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </label>

        <button class="btn" type="submit" :disabled="loading">
          {{ loading ? t('common.loading') : t('auth.submitRegister') }}
        </button>
        <NuxtLink class="muted" to="/login">{{ t('auth.toLogin') }}</NuxtLink>
      </form>

      <div v-if="message" class="message" :class="{ success: success }">
        {{ message }}
      </div>

      <pre v-if="output" class="token-box">{{ JSON.stringify(output, null, 2) }}</pre>
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

.card {
  width: 100%;
  max-width: 500px;
  background: #ffffff; /* White */
  border: 1px solid #e2e8f0; /* Slate 200 */
  border-radius: 8px;
  padding: 2.5rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

.header {
  margin-bottom: 2rem;
  text-align: center;
}

.header h1 {
  margin: 0.5rem 0;
  font-size: 1.75rem;
  font-weight: 600;
  color: #0f172a; /* Slate 900 */
}

.subtext {
  color: #64748b; /* Slate 500 */
  margin: 0;
  font-size: 0.95rem;
}

.eyebrow {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #2563eb; /* Blue 600 */
  font-weight: 600;
  margin: 0;
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
  color: #475569; /* Slate 600 */
  margin-bottom: 0.5rem;
}

input,
select {
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

input:focus,
select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}

.btn {
  width: 100%;
  margin-top: 0.5rem;
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
  text-align: center;
  margin-top: 0.5rem;
  color: #64748b;
  font-size: 0.875rem;
  text-decoration: none;
}

.muted:hover {
  color: #475569;
}

.message {
  margin-top: 1.5rem;
  padding: 0.75rem;
  border-radius: 6px;
  background: #fef2f2; /* Red 50 */
  border: 1px solid #fee2e2; /* Red 200 */
  color: #b91c1c; /* Red 700 */
  font-size: 0.875rem;
  text-align: center;
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

@media (max-width: 640px) {
  .card {
    padding: 1.5rem;
  }
}
</style>
