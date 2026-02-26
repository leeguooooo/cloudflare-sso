<template>
  <div class="signin-page">
    <main class="signin-main">
      <section class="signin-card">
        <div class="left-panel">
          <UiLogo size="lg" mode="icon" />
          <h1>Sign in</h1>
          <p>to continue to leeguoo Identity</p>
        </div>

        <div class="right-panel">
          <div v-if="!showForm" class="account-list">
            <button
              v-if="rememberedEmail"
              class="row account-row"
              :disabled="loading"
              @click="prefillRemembered"
            >
              <div class="avatar">{{ rememberedInitial }}</div>
              <div class="account-meta">
                <strong>{{ rememberedName }}</strong>
                <small>{{ rememberedEmail }}</small>
              </div>
              <span class="signed-out">Signed out</span>
            </button>

            <button class="row" :disabled="loading" @click="toggleForm(true)">
              <div class="row-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M20 21a8 8 0 1 0-16 0" />
                </svg>
              </div>
              <span>Use another account</span>
            </button>

            <button class="row" :disabled="loading || !rememberedEmail" @click="removeRemembered">
              <div class="row-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <span>Remove an account</span>
            </button>
          </div>

          <form v-if="showForm" class="login-form" @submit.prevent="handleSubmit">
            <UiInput
              v-model="form.email"
              type="email"
              label="Email"
              autocomplete="email"
              required
              :disabled="loading"
            />
            <UiInput
              v-model="form.password"
              type="password"
              label="Password"
              autocomplete="current-password"
              required
              :disabled="loading"
            />

            <p v-if="message" class="message" :class="{ success }">{{ message }}</p>

            <div class="form-actions">
              <UiButton
                variant="ghost"
                type="button"
                :disabled="loading"
                @click="toggleForm(false)"
              >
                Back
              </UiButton>
              <UiButton
                variant="primary"
                type="submit"
                :loading="loading"
              >
                Continue
              </UiButton>
            </div>
          </form>
        </div>
      </section>

      <footer class="signin-footer">
        <button class="language-btn">
          English (United States)
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
        <nav class="footer-links">
          <a href="#">Help</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </nav>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false,
})

const config = useRuntimeConfig()
const route = useRoute()
const loading = ref(false)
const message = ref('')
const success = ref(false)
const showForm = ref(false)
const rememberedEmail = ref('')

const form = reactive({
  email: 'demo@example.com',
  password: 'Passw0rd!',
})

const rememberedName = computed(() => {
  const email = rememberedEmail.value
  if (!email) return 'Cloudflare User'
  return email.split('@')[0]
})

const rememberedInitial = computed(() => {
  const name = rememberedName.value.trim()
  if (!name) return 'U'
  return name.slice(0, 1).toUpperCase()
})

const resolveContinuePath = () => {
  const raw = typeof route.query.continue === 'string' ? route.query.continue : ''
  if (!raw) return ''
  if (!raw.startsWith('/')) return ''
  if (raw.startsWith('//')) return ''
  return raw
}

const resolveClientId = () => {
  const queryClientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (queryClientId) return queryClientId

  const continuePath = resolveContinuePath()
  if (continuePath.startsWith('/authorize?')) {
    const params = new URLSearchParams(continuePath.split('?')[1] || '')
    const continueClientId = params.get('client_id') || ''
    if (continueClientId) return continueClientId
  }

  const configuredDefault = typeof config.public.defaultClientId === 'string' ? config.public.defaultClientId.trim() : ''
  return configuredDefault || 'demo-web'
}

const toggleForm = (open: boolean) => {
  showForm.value = open
  message.value = ''
  success.value = false
}

const prefillRemembered = () => {
  if (!rememberedEmail.value) return
  form.email = rememberedEmail.value
  toggleForm(true)
}

const removeRemembered = () => {
  rememberedEmail.value = ''
  if (process.client) {
    localStorage.removeItem('sso_last_email')
  }
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

    const data = await $fetch(`${config.public.apiBase}/auth/login`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        client_id: clientId,
      },
    })

    if (process.client) {
      const accessToken = (data as { access_token?: string }).access_token
      if (accessToken) {
        localStorage.setItem('sso_access_token', accessToken)
      }
      localStorage.setItem('sso_last_email', form.email)
    }

    message.value = 'Sign in successful'
    success.value = true
    const continuePath = resolveContinuePath()
    await navigateTo(continuePath || '/account')
  } catch (err: any) {
    const detail = err?.data?.message || err?.message || 'Login failed'
    message.value = detail
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!process.client) return
  rememberedEmail.value = localStorage.getItem('sso_last_email') || ''

  if (!rememberedEmail.value) {
    showForm.value = true
  }
})
</script>

<style scoped>
.signin-page {
  min-height: 100vh;
  background: #ffffff;
  color: #202124;
  font-family: 'Google Sans', 'Roboto', 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.signin-main {
  width: min(840px, 100%);
}

.signin-card {
  background: #ffffff;
  border-radius: 28px;
  min-height: 400px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  padding: 48px 40px;
  border: 1px solid #dadce0;
}

.left-panel {
  display: flex;
  flex-direction: column;
}

.left-panel h1 {
  margin: 16px 0 8px;
  font-size: 2.25rem;
  font-weight: 400;
  line-height: 2.75rem;
  color: #1f1f1f;
}

.left-panel p {
  margin: 0;
  color: #444746;
  font-size: 1rem;
  line-height: 1.5rem;
}

.google-logo {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
}

.right-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.account-list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.row {
  width: 100%;
  height: 56px;
  border: none;
  border-bottom: 1px solid #e0e0e0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 0 4px;
  color: #1f1f1f;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.row:hover {
  background-color: #f7f9fc;
}

.row:first-child {
  border-top: 1px solid #e0e0e0;
}

.account-row {
  height: 64px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background-color: #1a73e8;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
}

.account-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.account-meta strong {
  font-weight: 500;
  font-size: 0.875rem;
}

.account-meta small {
  color: #444746;
  font-size: 0.75rem;
  font-weight: 400;
}

.signed-out {
  color: #444746;
  font-size: 0.75rem;
  font-weight: 400;
}

.row-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #444746;
}

.login-form {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
}

.message {
  margin: 8px 0;
  font-size: 0.75rem;
  color: #b3261e;
  padding: 0 4px;
}

.message.success {
  color: #137333;
}

.signin-footer {
  margin-top: 16px;
  width: min(840px, 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px;
}

.language-btn {
  border: none;
  background: transparent;
  color: #444746;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
}

.language-btn:hover {
  background-color: #f7f9fc;
}

.footer-links {
  display: flex;
  gap: 24px;
}

.footer-links a {
  color: #444746;
  text-decoration: none;
  font-size: 0.75rem;
  padding: 8px;
  border-radius: 4px;
}

.footer-links a:hover {
  background-color: #f7f9fc;
}

@media (max-width: 900px) {
  .signin-main {
    width: min(450px, 100%);
  }

  .signin-card {
    grid-template-columns: 1fr;
    padding: 36px 24px;
    border-radius: 28px;
    min-height: auto;
    text-align: center;
  }

  .left-panel {
    align-items: center;
    margin-bottom: 24px;
  }

  .google-logo {
    margin-bottom: 0;
  }

  .left-panel h1 {
    font-size: 1.75rem;
    margin-top: 8px;
  }

  .signin-footer {
    width: min(450px, 100%);
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
}
</style>
