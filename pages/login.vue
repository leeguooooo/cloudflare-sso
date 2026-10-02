<template>
  <div class="miso-page" data-miso>
    <!-- hand-drawn "boil" filters -->
    <svg aria-hidden="true" class="miso-filters">
      <filter id="rough0"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough1"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough2"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="12" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="roughHi"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" /></filter>
    </svg>

    <!-- floating doodle decorations -->
    <svg class="deco deco-star" viewBox="0 0 24 24" width="38" height="38"><path d="M12 1 L14.5 8.5 L22 9.5 L16 14.5 L18 22 L12 17.5 L6 22 L8 14.5 L2 9.5 L9.5 8.5 Z" /></svg>
    <svg class="deco deco-spiral" viewBox="0 0 40 40" width="44" height="44"><path d="M20 20 m0 -2 a2 2 0 1 1 -2 2 a5 5 0 1 0 5 -5 a8 8 0 1 0 -8 8 a11 11 0 1 0 11 -11" /></svg>
    <svg class="deco deco-bolt" viewBox="0 0 24 24" width="24" height="24"><path d="M13 2 L4 14 L11 14 L9 22 L20 9 L13 9 Z" /></svg>
    <svg class="deco deco-cloud" viewBox="0 0 50 30" width="54" height="34"><path d="M10 22 a7 7 0 0 1 0 -13 a9 9 0 0 1 17 -2 a7 7 0 0 1 5 15 z" /></svg>

    <!-- wordmark -->
    <NuxtLink v-if="!nativeClient" to="/" class="wordmark">
      <span class="wordmark-bob wm-fallback">
        <span style="color:#ff5447;">m</span><span style="color:#3f6fe0;">i</span><span style="color:#36a85b;">s</span><span style="color:#e0a32a;">o</span><span style="color:#ff5447;">n</span><span style="color:#3f6fe0;">o</span><span style="color:#36a85b;">t</span><span style="color:#e0a32a;">e</span>
      </span>
    </NuxtLink>

    <!-- login card -->
    <div class="miso-card doodle-box">
      <div class="kicker">{{ t.loginKicker }}</div>
      <h1 class="title">{{ t.loginTitle }}<span class="wave">👋</span></h1>
      <svg class="title-underline" width="180" height="16" viewBox="0 0 180 16" fill="none">
        <path d="M6 9 C 40 3, 70 3, 96 8 S 150 14, 174 8" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" />
      </svg>
      <p class="subtitle">{{ subtitle }}</p>

      <!-- provider sign-in matched an existing account by email: never linked silently -->
      <div v-if="accountExists" class="exists-box" role="alert">
        <div class="exists-title">{{ t.accountExistsTitle }}</div>
        <p class="exists-body">{{ accountExistsBody }}</p>
        <button type="button" class="exists-action" @click="useExistingMethod">{{ t.accountExistsAction }}</button>
      </div>

      <!-- in-app browser warning (WeChat / QQ / …): Google OAuth 403s here -->
      <div v-if="showInAppBanner && providers.google" class="inapp-banner doodle-box" role="alert">
        <button type="button" class="inapp-close" aria-label="关闭提示" @click="bannerDismissed = true">×</button>
        <div class="inapp-head"><span class="inapp-emoji">🧭</span> 检测到你在{{ inAppLabel || 'App 内置浏览器' }}里打开</div>
        <p class="inapp-text">
          Google 登录会被拦截（Google 安全策略）。请点右上角 <b>···</b> →「在默认浏览器打开」，或直接用下方<b>邮箱密码</b>登录。
        </p>
        <button type="button" class="inapp-copy" @click="copyPageLink">
          {{ linkCopied ? '✓ 已复制，去浏览器粘贴打开' : '复制本页链接' }}
        </button>
      </div>

      <!-- Sign-in providers. Which ones show is decided server side (/api/auth/providers):
           native App Store clients only get Google / GitHub when Sign in with Apple is
           offered next to them (Guideline 4.8). Apple comes first, at least as prominent. -->
      <div v-if="anySocial" class="oauth">
        <button v-if="providers.apple" type="button" class="obtn obtn-apple" :disabled="loading" @click="startSocialLogin('apple')">
          <svg class="apple-logo" width="17" height="20" viewBox="0 0 814 1000" aria-hidden="true"><path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" /></svg>
          <span>{{ t.apple }}</span>
        </button>
        <button v-if="providers.google" type="button" class="obtn obtn-google doodle-box" :disabled="loading" @click="startSocialLogin('google')">
          <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12S6.8 21.5 12 21.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.06-1.1-.16-1.6z" /></svg>
          {{ t.google }}
        </button>
        <button v-if="providers.github" type="button" class="obtn obtn-github doodle-box" :disabled="loading" @click="startSocialLogin('github')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.04 10.04 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" /></svg>
          {{ t.github }}
        </button>
        <button v-if="providers.wechat" type="button" class="obtn obtn-wechat" :disabled="loading" @click="startSocialLogin('wechat')">
          <svg width="22" height="20" viewBox="0 0 24 22" aria-hidden="true"><path fill="#fff" d="M8.7 1C4.1 1 .4 4.1.4 8c0 2.2 1.2 4.2 3.1 5.5l-.8 2.4 2.8-1.4c1 .3 2.1.5 3.2.5h.6a6.4 6.4 0 0 1-.3-1.9c0-3.9 3.7-7 8.3-7h.5C17.1 3.1 13.3 1 8.7 1zM5.9 6.9a1 1 0 1 1 0-2.1 1 1 0 0 1 0 2.1zm5.6 0a1 1 0 1 1 0-2.1 1 1 0 0 1 0 2.1zM23.6 13.2c0-3.3-3.2-5.9-7.2-5.9s-7.2 2.6-7.2 5.9 3.2 5.9 7.2 5.9c.9 0 1.7-.1 2.5-.4l2.3 1.2-.6-2c1.8-1.1 3-2.8 3-4.7zm-9.5-1a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm4.7 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z" /></svg>
          {{ t.wechat }}
        </button>
      </div>

      <!-- divider -->
      <div v-if="anySocial" class="divider"><span class="dline" /><span class="dor">{{ t.or }}</span><span class="dline" /></div>

      <!-- email / password -->
      <form class="form" @submit.prevent="handleSubmit">
        <label class="field-label">
          <span class="flabel">{{ t.email }}</span>
          <span class="field doodle-box">
            <input v-model="form.email" type="email" required placeholder="you@example.com" autocomplete="email" :disabled="loading" />
          </span>
        </label>

        <label class="field-label">
          <span class="flabel flabel-row">
            <span>{{ t.password }}</span>
            <NuxtLink v-if="!nativeClient" :to="forgotPath" class="forgot">{{ t.forgot }}</NuxtLink>
          </span>
          <span class="field doodle-box field-pw">
            <input v-model="form.password" :type="showPw ? 'text' : 'password'" required placeholder="••••••••" autocomplete="current-password" :disabled="loading" />
            <button type="button" class="pw-toggle" :aria-label="t.showPassword" @click="togglePw">{{ showPw ? '🙈' : '👁' }}</button>
          </span>
        </label>

        <p v-if="message" class="miso-msg" :class="{ ok: success }">{{ message }}</p>

        <button type="submit" class="submit doodle-box" :disabled="loading">
          {{ loading ? t.submittingLogin : t.submitLogin }}
          <span class="arrow">→</span>
        </button>
      </form>

      <p class="signup">{{ t.noAccount }} <NuxtLink :to="registerPath" class="signup-link">{{ t.createOne }}</NuxtLink></p>
    </div>

    <!-- status footer -->
    <div class="status">
      <span class="dot" />
      {{ t.footer }}
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false,
})

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Permanent+Marker&family=Noto+Sans+SC:wght@400;500;700&display=swap',
    },
  ],
})

import { getInAppBrowserLabel, isInAppBrowser } from '~/utils/in-app-browser'
import { AUTH_COPY, clientAppName, detectAuthLocale, formatCopy, isNativeStoreClient, requestedClientId, safeContinuePath, type AuthLocale, type ProviderResponse } from '~/utils/auth-client'

const config = useRuntimeConfig()
const route = useRoute()
const loading = ref(false)
const message = ref('')
const success = ref(false)
const showForm = ref(true)
const showPw = ref(false)
const wordmarkFailed = ref(false)
const rememberedEmail = ref('')

const extraNativeIds = typeof config.public.nativeStoreClientIds === 'string' ? config.public.nativeStoreClientIds : ''
// Nothing social shows until the server answered which providers this client gets.
const providers = ref<ProviderResponse>({ apple: false, google: false, github: false })
const anySocial = computed(() => providers.value.apple || providers.value.google || providers.value.github || Boolean(providers.value.wechat))
const siwaPreview = route.query.siwa === '1'
const nativeClient = computed(() => isNativeStoreClient(requestedClientId(route.query), extraNativeIds))
const pageLocale = ref<AuthLocale>(detectAuthLocale(route.query, process.client ? navigator.languages || [navigator.language] : []))
const t = computed(() => AUTH_COPY[pageLocale.value])
const subtitle = computed(() => {
  const app = clientAppName(requestedClientId(route.query))
  return app ? formatCopy(t.value.loginSubtitleApp, { app }) : t.value.loginSubtitle
})
useHead({ htmlAttrs: { lang: () => (pageLocale.value === 'zh' ? 'zh-CN' : pageLocale.value) } })

// In-app browsers (WeChat / QQ / …) — Google hard-blocks OAuth inside them
// (403 disallowed_useragent), so we warn and intercept the Google button.
const inApp = ref(false)
const inAppLabel = ref('')
const bannerDismissed = ref(false)
const linkCopied = ref(false)
const showInAppBanner = computed(() => inApp.value && !bannerDismissed.value)
type SocialProvider = 'apple' | 'google' | 'github' | 'wechat'

const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google', github: 'GitHub' }
const accountExists = ref(false)
const accountExistsBody = computed(() =>
  formatCopy(t.value.accountExistsBody, {
    provider: PROVIDER_NAMES[String(route.query.provider || '')] || String(route.query.provider || ''),
    email: String(route.query.email || ''),
  }),
)
const useExistingMethod = () => {
  accountExists.value = false
  if (process.client) document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.focus()
}

const loadProviders = async () => {
  const fallback = { apple: false, google: !nativeClient.value, github: !nativeClient.value }
  try {
    const query = new URLSearchParams({ client_id: resolveClientId() })
    if (siwaPreview) query.set('siwa', '1')
    providers.value = await $fetch<ProviderResponse>(`${config.public.apiBase}/auth/providers?${query.toString()}`)
  } catch {
    providers.value = fallback
  }
}

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

const togglePw = () => {
  showPw.value = !showPw.value
}

const resolveContinuePath = () => safeContinuePath(route.query.continue)

const redirectAfterLogin = async () => {
  const continuePath = resolveContinuePath()
  if (continuePath.startsWith('/authorize?') && process.client) {
    window.location.assign(continuePath)
    return
  }
  await navigateTo(continuePath || '/account')
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

// With email sending configured the link starts a reset by mail; otherwise it explains the alternatives.
const forgotPath = computed(() => {
  if (!providers.value.password_reset) return '/help#password'
  const query = new URLSearchParams()
  const queryClientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (queryClientId) query.set('client_id', queryClientId)
  const continuePath = resolveContinuePath()
  if (continuePath) query.set('continue', continuePath)
  if (form.email) query.set('email', form.email)
  const queryString = query.toString()
  return queryString ? `/forgot-password?${queryString}` : '/forgot-password'
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
  if (
    hostname === 'account.misonote.com' || hostname.endsWith('.misonote.com') ||
    hostname === 'account.leeguoo.com' || hostname.endsWith('.leeguoo.com')
  ) {
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

    message.value = t.value.signedIn
    success.value = true
    await redirectAfterLogin()
  } catch (err: any) {
    const detail = err?.data?.message || err?.message || 'Login failed'
    message.value = detail
  } finally {
    loading.value = false
  }
}

const tryResumeRememberedSession = async () => {
  if (!process.client || loading.value) return

  loading.value = true
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

    if (!token) return

    const profile = await $fetch<UserInfoPayload>('/userinfo', {
      headers: { authorization: `Bearer ${token}` },
    })
    const targetEmail = (profile?.email || '').trim().toLowerCase()
    if (!targetEmail) return
    rememberedEmail.value = targetEmail
    localStorage.setItem('sso_last_email', targetEmail)

    await redirectAfterLogin()
  } catch {
    localStorage.removeItem('sso_access_token')
  } finally {
    loading.value = false
  }
}

const copyPageLink = async () => {
  if (!process.client) return
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    linkCopied.value = true
  } catch {
    // Older webviews block the async clipboard API — fall back to execCommand.
    try {
      const el = document.createElement('textarea')
      el.value = url
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      linkCopied.value = document.execCommand('copy')
      document.body.removeChild(el)
    } catch {
      linkCopied.value = false
    }
  }
  if (linkCopied.value) {
    setTimeout(() => {
      linkCopied.value = false
    }, 2500)
  }
}

const startSocialLogin = (provider: SocialProvider) => {
  if (!process.client || loading.value || !providers.value[provider]) return

  // Google OAuth 403s inside embedded webviews — never navigate there, just
  // re-surface the guidance so the user isn't dumped on Google's error page.
  if (provider === 'google' && inApp.value) {
    bannerDismissed.value = false
    message.value = `Google 登录在${inAppLabel.value || 'App 内置浏览器'}里会被拦截，请用右上角菜单在默认浏览器打开，或用下方邮箱密码登录。`
    success.value = false
    return
  }

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
  if (siwaPreview) query.set('siwa', '1')

  window.location.href = `${config.public.apiBase}/auth/oauth/start?${query.toString()}`
}

onMounted(() => {
  if (!process.client) return
  inApp.value = isInAppBrowser()
  inAppLabel.value = getInAppBrowserLabel()
  void loadProviders()
  rememberedEmail.value = localStorage.getItem('sso_last_email') || ''
  if (rememberedEmail.value && !form.email) {
    form.email = rememberedEmail.value
  }

  const registered = route.query.registered === '1'
  const prefillEmail = typeof route.query.email === 'string' ? route.query.email.trim() : ''
  if (prefillEmail) {
    form.email = prefillEmail
  }
  if (registered) {
    message.value = t.value.registered
    success.value = true
  }

  const oauthError = typeof route.query.oauth_error === 'string' ? route.query.oauth_error.trim() : ''
  if (route.query.oauth_error_code === 'account_exists') {
    accountExists.value = true
  }
  if (oauthError) {
    message.value = oauthError
    success.value = false
  }

  // /authorize sends reauth=1 when the stored session belongs to another tenant's client:
  // resuming it would just bounce back to /authorize forever.
  const reauth = route.query.reauth === '1'
  if (reauth) {
    localStorage.removeItem('sso_access_token')
  }

  const continuePath = resolveContinuePath()
  if (continuePath.startsWith('/authorize?') && !registered && !prefillEmail && !oauthError && !accountExists.value && !reauth) {
    void tryResumeRememberedSession()
  }
})
</script>

<style scoped>
.miso-page {
  position: relative;
  background: var(--color-background);
  min-height: 100vh;
  overflow-x: hidden;
  color: var(--color-text-primary);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  -webkit-font-smoothing: antialiased;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 18px;
}

.miso-filters { position: absolute; width: 0; height: 0; overflow: hidden; }

/* hand-drawn wobbling ink border, shared by card / buttons / fields */
.doodle-box { position: relative; }
.doodle-box::before {
  content: '';
  position: absolute;
  inset: -3px;
  border: 3px solid var(--color-border);
  border-radius: 22px 26px 19px 24px / 24px 19px 26px 22px;
  animation: boil .44s infinite;
  pointer-events: none;
}

/* per-element wobble radii + stroke + cadence, matching the design 1:1 */
.obtn-google::before { border-width: 2.6px; border-radius: 14px 17px 12px 15px / 15px 12px 17px 14px; animation-duration: .42s; }
.obtn-github::before { border-width: 2.6px; border-radius: 16px 12px 15px 11px / 11px 15px 12px 16px; animation-duration: .42s; }
.field::before { border-width: 2.5px; border-radius: 12px 15px 11px 14px / 14px 11px 15px 12px; animation-duration: .46s; }
.field-pw::before { border-radius: 14px 11px 15px 12px / 12px 15px 11px 14px; }
.submit::before { border-radius: 17px 20px 14px 18px / 18px 14px 20px 17px; animation-duration: .4s; }

@keyframes boil { 0%,32% { filter: url(#rough0); } 33%,65% { filter: url(#rough1); } 66%,100% { filter: url(#rough2); } }
@keyframes bob { 0%,100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-7px) rotate(1.5deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
@keyframes drift1 { 0%,100% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(6px,-11px) rotate(12deg); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(-9px,8px) rotate(-13deg); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes wiggle { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }

/* decorations */
.deco { position: absolute; animation: boil .42s infinite; }
.deco-star { left: 9%; top: 13%; fill: #ffd23d; stroke: var(--color-border); stroke-width: 1.4; animation: boil .42s infinite, drift1 6s ease-in-out infinite; }
.deco-spiral { right: 11%; top: 16%; fill: none; stroke: var(--color-primary-600); stroke-width: 2.4; stroke-linecap: round; animation: boil .42s infinite, spin 16s linear infinite; }
.deco-bolt { right: 8%; bottom: 18%; fill: #3f6fe0; stroke: var(--color-border); stroke-width: 1.4; animation: boil .42s infinite, wiggle 2.6s ease-in-out infinite; }
.deco-cloud { left: 7%; bottom: 14%; fill: #d8f0df; stroke: var(--color-border); stroke-width: 2; animation: boil .42s infinite, drift2 7s ease-in-out infinite; }

/* wordmark */
.wordmark { text-decoration: none; animation: rise .6s cubic-bezier(.2,.9,.3,1.4) .05s both; }
.wordmark-bob { display: inline-block; animation: bob 4s ease-in-out infinite; }
.wm-img { display: block; height: clamp(48px, 9vw, 64px); width: auto; }
.wm-fallback { font-family: 'ZCOOL KuaiLe', cursive; font-size: clamp(40px, 8vw, 56px); line-height: 1; }
.wm-fallback span { display: inline-block; }

/* card */
.miso-card {
  width: 100%;
  max-width: 400px;
  margin-top: 26px;
  background: var(--color-surface);
  padding: clamp(26px, 5vw, 38px) clamp(22px, 5vw, 34px) clamp(28px, 5vw, 36px);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  animation: rise .7s cubic-bezier(.2,.9,.3,1.4) .16s both;
}

.kicker { text-align: center; margin-bottom: 6px; font-family: 'Permanent Marker', cursive; font-size: 13px; color: var(--color-primary-600); letter-spacing: 1px; }
.title { font-family: 'ZCOOL KuaiLe', cursive; font-weight: 400; font-size: clamp(26px, 6vw, 34px); text-align: center; margin: 4px 0 0; line-height: 1.2; }
.wave { display: inline-block; animation: wiggle 1.8s ease-in-out infinite; transform-origin: 70% 70%; }
.title-underline { display: block; margin: 8px auto 0; }
.title-underline path { filter: url(#roughHi); stroke-dasharray: 230; stroke-dashoffset: 230; animation: draw 1s ease .5s forwards; }
.subtitle { text-align: center; font-size: var(--font-size-sm); color: var(--color-text-secondary); margin: 12px 0 24px; }

/* oauth */
.oauth { display: flex; flex-direction: column; gap: 12px; }
.obtn {
  display: flex; align-items: center; justify-content: center; gap: 11px;
  width: 100%; font-family: inherit; font-weight: 700; font-size: 15px;
  padding: 13px 16px; border: none; border-radius: 13px; cursor: pointer;
  transition: transform .12s;
}
.obtn:disabled { opacity: .6; cursor: default; }
.obtn-google { background: var(--color-surface); color: var(--color-text-primary); }
.obtn-github { background: var(--color-text-primary); color: var(--color-surface); }
.obtn-wechat { background: #07c160; color: #fff; min-height: 48px; }
.obtn-wechat:not(:disabled):hover { transform: translateY(-2px); background: #06ad56; }
.obtn:not(:disabled):hover { transform: translateY(-2px) rotate(-1deg); }
.obtn-github:not(:disabled):hover { transform: translateY(-2px) rotate(1deg); }
.obtn:active { transform: translateY(0) rotate(0); }

/* Sign in with Apple — Apple HIG: black button, white logo + title in the system font,
   same size as the other providers. No hand-drawn filter on Apple's mark. */
.obtn-apple {
  background: #000; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif;
  font-weight: 600; letter-spacing: -0.01em;
  border-radius: 13px;
  min-height: 48px;
}
.obtn-apple .apple-logo { flex: none; margin-top: -2px; }
.obtn-apple:not(:disabled):hover { transform: translateY(-2px); background: #1a1a1a; }

/* "account already exists" explanation */
.exists-box {
  background: var(--color-primary-50);
  border: 2px solid var(--color-border);
  border-radius: 15px;
  padding: 14px 16px 15px;
  margin-bottom: 18px;
}
.exists-title { font-weight: 700; font-size: 15px; color: var(--color-text-primary); }
.exists-body { font-size: 13px; line-height: 1.55; color: var(--color-text-secondary); margin: 7px 0 11px; }
.exists-action {
  font-family: inherit; font-weight: 700; font-size: 13px;
  background: var(--color-text-primary); color: var(--color-surface); border: none; cursor: pointer;
  padding: 8px 14px; border-radius: 11px;
}

/* in-app browser warning banner */
.inapp-banner {
  position: relative;
  background: var(--color-primary-50);
  border-radius: 15px 18px 13px 16px / 16px 13px 18px 15px;
  padding: 14px 16px 15px;
  margin-bottom: 18px;
}
.inapp-banner::before { border-width: 2.6px; border-radius: 15px 18px 13px 16px / 16px 13px 18px 15px; animation-duration: .45s; }
.inapp-close {
  position: absolute; top: 6px; right: 10px;
  background: transparent; border: none; cursor: pointer;
  font-size: 20px; line-height: 1; color: var(--color-text-tertiary); padding: 2px 4px;
}
.inapp-close:hover { color: var(--color-text-primary); }
.inapp-head { font-family: 'ZCOOL KuaiLe', cursive; font-size: 16px; color: var(--color-text-primary); padding-right: 18px; }
.inapp-emoji { margin-right: 4px; }
.inapp-text { font-size: 13px; line-height: 1.55; color: var(--color-text-secondary); margin: 7px 0 11px; }
.inapp-text b { color: var(--color-primary-600); font-weight: 700; }
.inapp-copy {
  font-family: inherit; font-weight: 700; font-size: 13px;
  background: var(--color-text-primary); color: var(--color-surface); border: none; cursor: pointer;
  padding: 8px 14px; border-radius: 11px; transition: transform .12s;
}
.inapp-copy:hover { transform: translateY(-1px) rotate(-1deg); }
.inapp-copy:active { transform: translateY(0) rotate(0); }

/* divider */
.divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; }
.dline { flex: 1; height: 3px; background: var(--color-border); border-radius: 3px; filter: url(#rough1); }
.dor { font-family: 'Permanent Marker', cursive; font-size: 13px; color: var(--color-text-tertiary); }

/* form */
.form { display: flex; flex-direction: column; gap: 15px; }
.field-label { display: block; }
.flabel { display: block; font-weight: 700; font-size: 13.5px; margin-bottom: 7px; }
.flabel-row { display: flex; align-items: center; justify-content: space-between; }
.forgot { font-size: 12.5px; color: var(--color-primary-600); text-decoration: none; font-weight: 600; }
.forgot:hover { color: var(--color-primary-700); text-decoration: underline; }
.field { display: block; }
.field-pw { display: flex; align-items: center; }
.field input {
  width: 100%; border: none; outline: none; background: var(--color-surface);
  font-family: inherit; font-size: var(--font-size-base); color: var(--color-text-primary); padding: 12px 14px; border-radius: var(--radius-lg);
}
.field input::placeholder { color: var(--color-text-tertiary); }
.pw-toggle { flex: none; background: transparent; border: none; cursor: pointer; padding: 0 12px 0 6px; font-size: 18px; line-height: 1; }

.miso-msg { margin: 2px 0 -4px; font-size: 13px; color: var(--color-danger, var(--color-primary-700)); font-weight: 600; text-align: center; }
.miso-msg.ok { color: var(--color-primary-700); }

.submit {
  margin-top: 4px; width: 100%; background: var(--color-primary-600); color: var(--color-surface);
  font-family: 'ZCOOL KuaiLe', cursive; font-size: 21px; padding: 14px 16px;
  border: none; border-radius: 15px; cursor: pointer;
  transition: transform .12s, background .15s;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.submit:not(:disabled):hover { background: var(--color-primary-700); transform: translateY(-2px); }
.submit:active { transform: translateY(0); }
.submit:disabled { opacity: .7; cursor: default; }
.arrow { display: inline-block; }

.signup { text-align: center; font-size: 13.5px; color: var(--color-text-secondary); margin: 20px 0 0; }
.signup-link { color: var(--color-primary-600); text-decoration: none; font-weight: 700; }
.signup-link:hover { color: var(--color-primary-700); text-decoration: underline; }

/* status footer */
.status {
  margin-top: 22px; display: flex; align-items: center; gap: 9px;
  font-family: 'Permanent Marker', cursive; font-size: 12.5px; color: var(--color-text-tertiary);
  animation: rise .7s ease .3s both;
}
.dot { width: 9px; height: 9px; border-radius: var(--radius-full); background: var(--color-primary-600); border: 1.5px solid var(--color-border); animation: blink 1.6s steps(1) infinite; }

@media (max-width: 640px) {
  .deco { display: none !important; }
}
/* The display fonts only cover Latin + Simplified Chinese; use the system sans for ja/ko. */
:lang(ja) .title, :lang(ko) .title, :lang(ja) .submit, :lang(ko) .submit {
  font-family: var(--font-family-sans);
  font-weight: 700;
  word-break: keep-all;
}
:lang(ja) .title, :lang(ko) .title { font-size: clamp(24px, 5.6vw, 30px); }
@media (prefers-reduced-motion: reduce) {
  .miso-page *:not(input) { animation-duration: .001s !important; animation-iteration-count: 1 !important; }
}
</style>
