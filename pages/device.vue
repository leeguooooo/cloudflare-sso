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
      <div class="kicker">{{ t.deviceKicker }}</div>
      <h1 class="title">{{ t.deviceTitle }}</h1>
      <svg class="title-underline" width="180" height="16" viewBox="0 0 180 16" fill="none">
        <path d="M6 9 C 40 3, 70 3, 96 8 S 150 14, 174 8" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" />
      </svg>

      <p v-if="phase === 'loading'" class="subtitle">…</p>

      <template v-else-if="phase === 'confirm'">
        <p class="subtitle">{{ requestText }}</p>
        <div class="code-box doodle-box" aria-live="polite">{{ info.user_code }}</div>
        <p class="hint">{{ t.deviceCompare }}</p>

        <div class="account-row">
          <span class="account-label">{{ t.deviceSignedInAs }}</span>
          <span class="account-email">{{ info.email }}</span>
          <a :href="switchPath" class="signup-link">{{ t.deviceSwitch }}</a>
        </div>

        <p v-if="message" class="miso-msg">{{ message }}</p>

        <div class="actions">
          <button type="button" class="deny doodle-box" :disabled="busy" @click="decide('deny')">{{ t.deviceDeny }}</button>
          <button type="button" class="submit doodle-box" :disabled="busy" @click="decide('approve')">
            {{ busy ? t.deviceApproving : t.deviceApprove }}
            <span class="arrow">→</span>
          </button>
        </div>
      </template>

      <div v-else-if="phase === 'approved'" class="sent-box" role="status">
        <p>{{ formatCopy(t.deviceApproved, { device: deviceName }) }}</p>
      </div>

      <div v-else-if="phase === 'denied'" class="sent-box sent-box-warn" role="status">
        <p>{{ t.deviceDenied }}</p>
        <a href="/device" class="box-action">{{ t.deviceOtherCode }}</a>
      </div>

      <template v-else>
        <p class="subtitle">{{ t.deviceSubtitle }}</p>
        <form class="form" @submit.prevent="submitCode">
          <label class="field-label">
            <span class="flabel">{{ t.deviceCodeLabel }}</span>
            <span class="field doodle-box">
              <input
                v-model="codeInput"
                class="code-input"
                type="text"
                required
                maxlength="9"
                placeholder="XXXX-XXXX"
                autocomplete="one-time-code"
                autocapitalize="characters"
                spellcheck="false"
                :disabled="busy"
                @input="formatInput"
              />
            </span>
          </label>

          <p v-if="message" class="miso-msg">{{ message }}</p>

          <button type="submit" class="submit doodle-box" :disabled="busy">
            {{ t.deviceContinue }}
            <span class="arrow">→</span>
          </button>
        </form>
        <div v-if="info.email" class="account-row account-row-center">
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

type LookupPayload = {
  signed_in: boolean
  email: string | null
  user_code: string | null
  client_id?: string
  client_name?: string
  device_name?: string | null
  status?: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'
  error?: string
}

const config = useRuntimeConfig()
const route = useRoute()
const pageLocale = ref<AuthLocale>(detectAuthLocale(route.query, process.client ? navigator.languages || [navigator.language] : []))
const t = computed(() => AUTH_COPY[pageLocale.value])
useHead({
  title: () => t.value.deviceTitle,
  htmlAttrs: { lang: () => (pageLocale.value === 'zh' ? 'zh-CN' : pageLocale.value) },
})

const phase = ref<'loading' | 'enter' | 'confirm' | 'approved' | 'denied'>('loading')
const info = ref<LookupPayload>({ signed_in: false, email: null, user_code: null })
const codeInput = ref('')
const message = ref('')
const busy = ref(false)

const deviceName = computed(() => info.value.device_name || t.value.deviceDefaultName)
const requestText = computed(() =>
  formatCopy(t.value.deviceRequest, { app: info.value.client_name || info.value.client_id || '', device: deviceName.value }),
)

const devicePath = (code: string) => (code ? `/device?user_code=${encodeURIComponent(code)}` : '/device')
const loginPath = (code: string, clientId?: string, reauth = false) => {
  const query = new URLSearchParams({ continue: devicePath(code) })
  if (clientId) query.set('client_id', clientId)
  if (reauth) query.set('reauth', '1')
  return `/login?${query.toString()}`
}
const switchPath = computed(() => loginPath(info.value.user_code || '', info.value.client_id, true))

const errorText = (code: string | undefined) => {
  if (code === 'invalid_user_code') return t.value.deviceInvalid
  if (code === 'expired_user_code') return t.value.deviceExpired
  if (code === 'already_handled') return t.value.deviceUsed
  if (code === 'too_many_requests') return t.value.tooMany
  return t.value.genericError
}

const load = async (code: string) => {
  phase.value = 'loading'
  message.value = ''
  let data: LookupPayload
  try {
    const query = code ? `?user_code=${encodeURIComponent(code)}` : ''
    data = await $fetch<LookupPayload>(`${config.public.apiBase}/auth/device/lookup${query}`)
  } catch (err: any) {
    data = (err?.data as LookupPayload) || { signed_in: false, email: null, user_code: null, error: 'server_error' }
  }
  info.value = data
  if (!data.signed_in) {
    window.location.replace(loginPath(code, data.client_id))
    return
  }
  codeInput.value = data.user_code || code
  if (data.error) message.value = errorText(data.error)
  else if (data.status === 'expired') message.value = t.value.deviceExpired
  else if (data.status && data.status !== 'pending') message.value = t.value.deviceUsed
  phase.value = data.status === 'pending' ? 'confirm' : 'enter'
}

const formatInput = () => {
  const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  codeInput.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

const submitCode = async () => {
  formatInput()
  const code = codeInput.value
  if (!code) return
  await navigateTo(devicePath(code), { replace: true })
  await load(code)
}

const decide = async (action: 'approve' | 'deny') => {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    await $fetch(`${config.public.apiBase}/auth/device/verify`, {
      method: 'POST',
      body: { user_code: info.value.user_code, action },
    })
    phase.value = action === 'approve' ? 'approved' : 'denied'
  } catch (err: any) {
    const status = err?.statusCode || err?.status || err?.response?.status
    const code = err?.data?.error as string | undefined
    if (status === 401) {
      window.location.replace(loginPath(info.value.user_code || '', info.value.client_id))
      return
    }
    message.value = errorText(code)
    if (code === 'expired_user_code' || code === 'already_handled' || code === 'invalid_user_code') phase.value = 'enter'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  const code = typeof route.query.user_code === 'string' ? route.query.user_code.trim() : ''
  void load(code)
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
