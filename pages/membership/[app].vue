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
      <div class="kicker">{{ t.membershipKicker }}</div>
      <h1 class="title">{{ info.name || t.membershipTitle }}</h1>
      <svg class="title-underline" width="180" height="16" viewBox="0 0 180 16" fill="none">
        <path d="M6 9 C 40 3, 70 3, 96 8 S 150 14, 174 8" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" />
      </svg>

      <p v-if="loading" class="subtitle">…</p>

      <template v-else>
        <div class="status-box doodle-box" role="status">
          <p class="status-line">{{ statusText }}</p>
          <p v-if="info.available && info.price_label" class="price">{{ info.price_label }}</p>
        </div>

        <div v-if="!info.available" class="sent-box sent-box-warn" role="status">
          <p>{{ t.membershipUnavailable }}</p>
        </div>

        <template v-else>
          <p v-if="message" class="miso-msg">{{ message }}</p>
          <button type="button" class="submit doodle-box" :disabled="busy" @click="buy">
            {{ busy ? t.membershipRedirecting : info.status === 'member' || info.status === 'trial' ? t.membershipRenew : t.membershipBuy }}
            <span class="arrow">→</span>
          </button>
          <div v-if="returned" class="sent-box after-pay" role="status">
            <p>{{ t.membershipAfterPay }}</p>
            <button type="button" class="box-action" @click="load">{{ t.membershipRefresh }}</button>
          </div>
          <p v-else class="hint">{{ t.membershipAfterPay }}</p>
        </template>

        <div class="account-row account-row-center">
          <span class="account-label">{{ t.deviceSignedInAs }}</span>
          <span class="account-email">{{ info.email }}</span>
          <a :href="switchPath" class="signup-link">{{ t.deviceSwitch }}</a>
        </div>
      </template>
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

import { AUTH_COPY, detectAuthLocale, formatCopy, type AuthLocale } from '~/utils/auth-client'

type MembershipPayload = {
  signed_in: boolean
  email: string | null
  app_key: string
  available: boolean
  name: string | null
  price_label: string | null
  status: 'member' | 'trial' | 'expired' | 'none'
  valid_to: number | null
}

const config = useRuntimeConfig()
const route = useRoute()
const appKey = String(route.params.app || '').trim().toLowerCase()
const pageLocale = ref<AuthLocale>(detectAuthLocale(route.query, process.client ? navigator.languages || [navigator.language] : []))
const t = computed(() => AUTH_COPY[pageLocale.value])
useHead({
  title: () => info.value.name || t.value.membershipTitle,
  htmlAttrs: { lang: () => (pageLocale.value === 'zh' ? 'zh-CN' : pageLocale.value) },
})

const info = ref<MembershipPayload>({ signed_in: false, email: null, app_key: appKey, available: false, name: null, price_label: null, status: 'none', valid_to: null })
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const returned = ref(false)
const RETURN_FLAG = `membership_checkout:${appKey}`

const pagePath = `/membership/${encodeURIComponent(appKey)}`
const loginPath = (reauth = false) => `/login?${new URLSearchParams({ continue: pagePath, ...(reauth ? { reauth: '1' } : {}) }).toString()}`
const switchPath = computed(() => loginPath(true))

const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(pageLocale.value === 'zh' ? 'zh-CN' : pageLocale.value, { year: 'numeric', month: 'long', day: 'numeric' })

const statusText = computed(() => {
  const { status, valid_to: validTo } = info.value
  if (status === 'member') return validTo ? formatCopy(t.value.membershipStatusMember, { date: formatDate(validTo) }) : t.value.membershipStatusForever
  if (status === 'trial' && validTo) {
    const days = String(Math.max(0, Math.ceil((validTo - Date.now() / 1000) / 86400)))
    return formatCopy(t.value.membershipStatusTrial, { days, date: formatDate(validTo) })
  }
  if (status === 'expired' && validTo) return formatCopy(t.value.membershipStatusExpired, { date: formatDate(validTo) })
  return t.value.membershipStatusNone
})

const load = async () => {
  message.value = ''
  try {
    info.value = await $fetch<MembershipPayload>(`${config.public.apiBase}/billing/afdian/membership?app_key=${encodeURIComponent(appKey)}`)
  } catch {
    message.value = t.value.genericError
  }
  if (!info.value.signed_in) {
    window.location.replace(loginPath())
    return
  }
  loading.value = false
}

const buy = async () => {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const data = await $fetch<{ url: string }>(`${config.public.apiBase}/billing/afdian/checkout`, {
      method: 'POST',
      body: { app_key: appKey, month: 1 },
    })
    try {
      sessionStorage.setItem(RETURN_FLAG, String(Date.now()))
    } catch {}
    window.location.assign(data.url)
  } catch (err: any) {
    const status = err?.statusCode || err?.status || err?.response?.status
    if (status === 401) {
      window.location.replace(loginPath())
      return
    }
    message.value = err?.data?.error === 'not_available' ? t.value.membershipUnavailable : status === 429 ? t.value.tooMany : t.value.genericError
    busy.value = false
  }
}

// afdian rarely sends people back, so coming back (or reopening the tab) re-reads the status.
const onVisible = () => {
  if (document.visibilityState === 'visible' && returned.value) void load()
}

onMounted(() => {
  try {
    const started = Number(sessionStorage.getItem(RETURN_FLAG) || 0)
    returned.value = started > 0 && Date.now() - started < 24 * 3600 * 1000
  } catch {}
  document.addEventListener('visibilitychange', onVisible)
  void load()
})

onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
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
.sent-box p { margin: 0 0 10px; }
.sent-box-warn { background: var(--color-surface); }
.box-action {
  display: inline-block;
  font-weight: 700; font-size: 13px;
  background: var(--color-text-primary); color: var(--color-surface);
  padding: 8px 14px; border-radius: 11px; text-decoration: none;
}
.box-action:hover { transform: translateY(-1px); }

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

.hint { text-align: center; font-size: 13px; color: var(--color-text-secondary); margin: 12px 0 0; }
.code-box {
  margin: 4px auto 0;
  width: fit-content;
  padding: 12px 22px;
  border-radius: 15px;
  background: var(--color-primary-50);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(26px, 7vw, 34px);
  font-weight: 700;
  letter-spacing: 4px;
}
.field .code-input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; letter-spacing: 3px; text-align: center; text-transform: uppercase; }
.account-row {
  margin: 20px 0 4px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px;
  font-size: 13.5px; color: var(--color-text-secondary);
}
.account-row-center { justify-content: center; }
.account-email { font-weight: 700; color: var(--color-text-primary); word-break: break-all; }
.actions { margin-top: 16px; display: flex; gap: 12px; }
.actions .submit { margin-top: 0; flex: 1; }
.deny {
  flex: 0 0 auto; background: var(--color-surface); color: var(--color-text-primary);
  font-family: 'ZCOOL KuaiLe', cursive; font-size: 19px; padding: 14px 18px;
  border: none; border-radius: 15px; cursor: pointer;
}
.deny::before { border-radius: 17px 20px 14px 18px / 18px 14px 20px 17px; animation-duration: .4s; }
.deny:disabled { opacity: .7; cursor: default; }
:lang(ja) .deny, :lang(ko) .deny { font-family: var(--font-family-sans); font-weight: 700; }

.status-box {
  margin: 0 0 18px; padding: 14px 16px; border-radius: 15px; background: var(--color-primary-50); text-align: center;
}
.status-line { margin: 0; font-weight: 700; font-size: 15px; }
.price { margin: 6px 0 0; font-family: 'ZCOOL KuaiLe', cursive; font-size: 22px; color: var(--color-primary-600); }
.after-pay { margin-top: 16px; }

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
