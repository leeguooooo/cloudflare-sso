<template>
  <div class="signin-page">
    <main class="signin-main">
      <UiCard
        class="signin-card"
        :style="{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '32px',
          padding: '48px 40px',
          minHeight: '400px',
        }"
      >
        <div class="left-panel">
          <UiLogo size="lg" mode="icon" />
          <h1>Sign in</h1>
          <p>to continue to leeguoo Identity</p>
        </div>

        <div class="right-panel">
          <div v-if="!showForm" class="account-list">
            <UiButton
              v-if="rememberedEmail"
              unstyled
              type="button"
              class="row account-row"
              :disabled="loading"
              @click="tryResumeRememberedSession"
            >
              <div class="avatar">{{ rememberedInitial }}</div>
              <div class="account-meta">
                <strong>{{ rememberedName }}</strong>
                <small>{{ rememberedEmail }}</small>
              </div>
              <span class="signed-out">Signed out</span>
            </UiButton>

            <UiButton unstyled type="button" class="row" :disabled="loading" @click="toggleForm(true)">
              <div class="row-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M20 21a8 8 0 1 0-16 0" />
                </svg>
              </div>
              <span>Use another account</span>
            </UiButton>

            <UiButton unstyled type="button" class="row" :disabled="loading || !rememberedEmail" @click="removeRemembered">
              <div class="row-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <span>Remove an account</span>
            </UiButton>
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
              <NuxtLink :to="registerPath" class="create-account-link">
                Create account
              </NuxtLink>
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

          <div class="oauth-section">
            <p class="oauth-title">Or continue with</p>
            <div class="oauth-buttons">
              <UiButton unstyled class="oauth-btn" type="button" :disabled="loading" @click="startSocialLogin('google')">
                Google
              </UiButton>
              <UiButton unstyled class="oauth-btn" type="button" :disabled="loading" @click="startSocialLogin('github')">
                GitHub
              </UiButton>
              <UiButton unstyled class="oauth-btn oauth-btn-disabled" type="button" disabled title="Coming soon">
                WeChat (planned)
              </UiButton>
            </div>
          </div>
        </div>
      </UiCard>

      <footer class="signin-footer">
        <UiButton unstyled type="button" class="language-btn">
          English (United States)
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </UiButton>
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
type SocialProvider = 'google' | 'github'

type UserInfoPayload = {
  email: string
}

type RefreshPayload = {
  access_token?: string
}

const form = reactive({
  email: '',
  password: '',
})

const rememberedName = computed(() => {
  const email = rememberedEmail.value
  if (!email) return 'leeguoo User'
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

const registerPath = computed(() => {
  const query = new URLSearchParams()
  const queryClientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (queryClientId) {
    query.set('client_id', queryClientId)
  }
  const continuePath = resolveContinuePath()
  if (continuePath) {
    query.set('continue', continuePath)
  }
  const queryString = query.toString()
  return queryString ? `/register?${queryString}` : '/register'
})

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
  if (configuredDefault) return configuredDefault

  const hostname = process.client ? window.location.hostname.toLowerCase() : ''
  if (hostname === 'account.misonote.com' || hostname.endsWith('.misonote.com')) {
    return 'misonote-app-web'
  }
  return 'demo-web'
}

const toggleForm = (open: boolean) => {
  showForm.value = open
  message.value = ''
  success.value = false
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

const tryResumeRememberedSession = async () => {
  if (!process.client || loading.value) return
  if (!rememberedEmail.value) {
    toggleForm(true)
    return
  }

  loading.value = true
  message.value = ''
  success.value = false

  try {
    let token = localStorage.getItem('sso_access_token') || ''
    if (!token) {
      try {
        const refreshData = await $fetch<RefreshPayload>(`${config.public.apiBase}/auth/refresh`, {
          method: 'POST',
          body: {},
        })
        token = refreshData?.access_token || ''
        if (token) localStorage.setItem('sso_access_token', token)
      } catch {
        token = ''
      }
    }

    if (!token) {
      form.email = rememberedEmail.value
      toggleForm(true)
      return
    }

    const profile = await $fetch<UserInfoPayload>(`${config.public.apiBase}/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const targetEmail = profile?.email || ''
    if (!targetEmail || targetEmail.toLowerCase() !== rememberedEmail.value.toLowerCase()) {
      form.email = rememberedEmail.value
      toggleForm(true)
      return
    }

    const continuePath = resolveContinuePath()
    await navigateTo(continuePath || '/account')
  } catch {
    localStorage.removeItem('sso_access_token')
    form.email = rememberedEmail.value
    toggleForm(true)
  } finally {
    loading.value = false
  }
}

const startSocialLogin = (provider: SocialProvider) => {
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

onMounted(() => {
  if (!process.client) return
  rememberedEmail.value = localStorage.getItem('sso_last_email') || ''

  const registered = route.query.registered === '1'
  const prefillEmail = typeof route.query.email === 'string' ? route.query.email.trim() : ''
  if (prefillEmail) {
    form.email = prefillEmail
    showForm.value = true
  }
  if (registered) {
    message.value = 'Account created successfully. Please sign in.'
    success.value = true
    showForm.value = true
  }

const oauthError = typeof route.query.oauth_error === 'string' ? route.query.oauth_error.trim() : ''
  if (oauthError) {
    message.value = oauthError
    success.value = false
    showForm.value = true
  }

  if (!rememberedEmail.value) {
    showForm.value = true
  }
})
</script>

<style scoped>
.signin-page {
  min-height: 100vh;
  background: var(--color-background);
  color: var(--color-text-primary);
  font-family: var(--font-family-sans);
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
  background: var(--color-surface);
  border-radius: 28px;
  min-height: 400px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  padding: 48px 40px;
  border: 1px solid var(--color-border);
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
  color: var(--color-text-primary);
}

.left-panel p {
  margin: 0;
  color: var(--color-text-secondary);
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
  border-bottom: 1px solid var(--color-neutral-200);
  background: transparent;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 0 4px;
  color: var(--color-text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.row:hover {
  background-color: var(--color-primary-50);
}

.row:first-child {
  border-top: 1px solid var(--color-neutral-200);
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
  background-color: var(--color-primary-600);
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
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 400;
}

.signed-out {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 400;
}

.row-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.login-form {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.oauth-section {
  margin-top: 18px;
}

.oauth-title {
  margin: 0 0 10px;
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
}

.oauth-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.oauth-btn {
  min-width: 120px;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0 16px;
  transition: background-color 0.2s;
}

.oauth-btn:hover:not(:disabled) {
  background: var(--color-primary-50);
}

.oauth-btn-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
}

.create-account-link {
  color: var(--color-primary-600);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 8px 4px;
}

.create-account-link:hover {
  text-decoration: underline;
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
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
}

.language-btn:hover {
  background-color: var(--color-primary-50);
}

.footer-links {
  display: flex;
  gap: 24px;
}

.footer-links a {
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 0.75rem;
  padding: 8px;
  border-radius: 4px;
}

.footer-links a:hover {
  background-color: var(--color-primary-50);
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
