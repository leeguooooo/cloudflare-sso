<template>
  <div class="miso-page" data-miso>
    <svg aria-hidden="true" class="miso-filters">
      <filter id="rough0"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough1"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough2"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="12" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="roughHi"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" /></filter>
    </svg>

    <NuxtLink to="/" class="wordmark">
      <span class="wordmark-bob wm-fallback">
        <span style="color:#ff5447;">m</span><span style="color:#3f6fe0;">i</span><span style="color:#36a85b;">s</span><span style="color:#e0a32a;">o</span><span style="color:#ff5447;">n</span><span style="color:#3f6fe0;">o</span><span style="color:#36a85b;">t</span><span style="color:#e0a32a;">e</span>
      </span>
    </NuxtLink>

    <div class="miso-card doodle-box">
      <div class="kicker">{{ t.forgotKicker }}</div>
      <h1 class="title">{{ t.forgotTitle }}</h1>
      <svg class="title-underline" width="180" height="16" viewBox="0 0 180 16" fill="none">
        <path d="M6 9 C 40 3, 70 3, 96 8 S 150 14, 174 8" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" />
      </svg>
      <p class="subtitle">{{ t.forgotSubtitle }}</p>

      <div v-if="sent" class="sent-box" role="status">
        <p>{{ t.forgotSent }}</p>
      </div>

      <form v-else class="form" @submit.prevent="handleSubmit">
        <label class="field-label">
          <span class="flabel">{{ t.email }}</span>
          <span class="field doodle-box">
            <input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" :disabled="loading" />
          </span>
        </label>

        <p v-if="message" class="miso-msg">{{ message }}</p>

        <button type="submit" class="submit doodle-box" :disabled="loading">
          {{ loading ? t.forgotSubmitting : t.forgotSubmit }}
          <span class="arrow">→</span>
        </button>
      </form>

      <p class="signup"><NuxtLink :to="loginPath" class="signup-link">{{ t.backToLogin }}</NuxtLink></p>
    </div>

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

import { AUTH_COPY, detectAuthLocale, requestedClientId, safeContinuePath, type AuthLocale } from '~/utils/auth-client'

const config = useRuntimeConfig()
const route = useRoute()
const pageLocale = ref<AuthLocale>(detectAuthLocale(route.query, process.client ? navigator.languages || [navigator.language] : []))
const t = computed(() => AUTH_COPY[pageLocale.value])
useHead({
  title: () => t.value.forgotTitle,
  htmlAttrs: { lang: () => (pageLocale.value === 'zh' ? 'zh-CN' : pageLocale.value) },
})

const email = ref(typeof route.query.email === 'string' ? route.query.email.trim() : '')
const loading = ref(false)
const sent = ref(false)
const message = ref('')

/** Back to sign-in with the same client_id / continue, so an OIDC flow can resume. */
const loginPath = computed(() => {
  const query = new URLSearchParams()
  const clientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (clientId) query.set('client_id', clientId)
  const continuePath = safeContinuePath(route.query.continue)
  if (continuePath) query.set('continue', continuePath)
  const queryString = query.toString()
  return queryString ? `/login?${queryString}` : '/login'
})

const handleSubmit = async () => {
  loading.value = true
  message.value = ''
  try {
    const clientId = requestedClientId(route.query)
    await $fetch(`${config.public.apiBase}/auth/password/forgot`, {
      method: 'POST',
      body: { email: email.value.trim(), ...(clientId ? { client_id: clientId } : {}) },
    })
    sent.value = true
  } catch (err: any) {
    const status = err?.statusCode || err?.status || err?.response?.status
    message.value = status === 429 ? t.value.tooMany : t.value.genericError
  } finally {
    loading.value = false
  }
}
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
.field::before { border-width: 2.5px; border-radius: 12px 15px 11px 14px / 14px 11px 15px 12px; animation-duration: .46s; }
.submit::before { border-radius: 17px 20px 14px 18px / 18px 14px 20px 17px; animation-duration: .4s; }

@keyframes boil { 0%,32% { filter: url(#rough0); } 33%,65% { filter: url(#rough1); } 66%,100% { filter: url(#rough2); } }
@keyframes bob { 0%,100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-7px) rotate(1.5deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }

.wordmark { text-decoration: none; animation: rise .6s cubic-bezier(.2,.9,.3,1.4) .05s both; }
.wordmark-bob { display: inline-block; animation: bob 4s ease-in-out infinite; }
.wm-fallback { font-family: 'ZCOOL KuaiLe', cursive; font-size: clamp(40px, 8vw, 56px); line-height: 1; }
.wm-fallback span { display: inline-block; }

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
.title-underline { display: block; margin: 8px auto 0; }
.title-underline path { filter: url(#roughHi); stroke-dasharray: 230; stroke-dashoffset: 230; animation: draw 1s ease .5s forwards; }
.subtitle { text-align: center; font-size: var(--font-size-sm); color: var(--color-text-secondary); margin: 12px 0 24px; }

.sent-box {
  background: var(--color-primary-50);
  border: 2px solid var(--color-border);
  border-radius: 15px;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary);
}
.sent-box p { margin: 0; }

.form { display: flex; flex-direction: column; gap: 15px; }
.field-label { display: block; }
.flabel { display: block; font-weight: 700; font-size: 13.5px; margin-bottom: 7px; }
.field { display: block; }
.field input {
  width: 100%; border: none; outline: none; background: var(--color-surface);
  font-family: inherit; font-size: var(--font-size-base); color: var(--color-text-primary); padding: 12px 14px; border-radius: var(--radius-lg);
}
.field input::placeholder { color: var(--color-text-tertiary); }

.miso-msg { margin: 2px 0 -4px; font-size: 13px; color: var(--color-danger, var(--color-primary-700)); font-weight: 600; text-align: center; }

.submit {
  margin-top: 4px; width: 100%; background: var(--color-primary-600); color: var(--color-surface);
  font-family: 'ZCOOL KuaiLe', cursive; font-size: 21px; padding: 14px 16px;
  border: none; border-radius: 15px; cursor: pointer;
  transition: transform .12s, background .15s;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.submit:not(:disabled):hover { background: var(--color-primary-700); transform: translateY(-2px); }
.submit:disabled { opacity: .7; cursor: default; }

.signup { text-align: center; font-size: 13.5px; color: var(--color-text-secondary); margin: 20px 0 0; }
.signup-link { color: var(--color-primary-600); text-decoration: none; font-weight: 700; }
.signup-link:hover { color: var(--color-primary-700); text-decoration: underline; }

.status {
  margin-top: 22px; display: flex; align-items: center; gap: 9px;
  font-family: 'Permanent Marker', cursive; font-size: 12.5px; color: var(--color-text-tertiary);
  animation: rise .7s ease .3s both;
}
.dot { width: 9px; height: 9px; border-radius: var(--radius-full); background: var(--color-primary-600); border: 1.5px solid var(--color-border); animation: blink 1.6s steps(1) infinite; }

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
