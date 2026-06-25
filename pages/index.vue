<template>
  <div class="miso-page" data-miso>
    <svg aria-hidden="true" class="miso-filters">
      <filter id="rough0"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough1"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough2"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="12" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="roughHi"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" /></filter>
    </svg>

    <svg class="deco deco-star" viewBox="0 0 24 24" width="38" height="38"><path d="M12 1 L14.5 8.5 L22 9.5 L16 14.5 L18 22 L12 17.5 L6 22 L8 14.5 L2 9.5 L9.5 8.5 Z" /></svg>
    <svg class="deco deco-spiral" viewBox="0 0 40 40" width="44" height="44"><path d="M20 20 m0 -2 a2 2 0 1 1 -2 2 a5 5 0 1 0 5 -5 a8 8 0 1 0 -8 8 a11 11 0 1 0 11 -11" /></svg>
    <svg class="deco deco-bolt" viewBox="0 0 24 24" width="24" height="24"><path d="M13 2 L4 14 L11 14 L9 22 L20 9 L13 9 Z" /></svg>
    <svg class="deco deco-cloud" viewBox="0 0 50 30" width="54" height="34"><path d="M10 22 a7 7 0 0 1 0 -13 a9 9 0 0 1 17 -2 a7 7 0 0 1 5 15 z" /></svg>

    <NuxtLink to="/" class="wordmark">
      <span class="wordmark-bob">
        <span style="color:#ff5447;">m</span><span style="color:#3f6fe0;">i</span><span style="color:#36a85b;">s</span><span style="color:#e0a32a;">o</span><span style="color:#ff5447;">n</span><span style="color:#3f6fe0;">o</span><span style="color:#36a85b;">t</span><span style="color:#e0a32a;">e</span>
      </span>
    </NuxtLink>

    <div class="miso-card doodle-box">
      <div class="kicker">✦ one account ✦</div>
      <h1 class="title">一个账号，到处折腾<span class="wave">🔑</span></h1>
      <svg class="title-underline" width="200" height="16" viewBox="0 0 200 16" fill="none">
        <path d="M6 9 C 50 3, 90 3, 116 8 S 170 14, 194 8" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" />
      </svg>
      <p class="subtitle">用一个 misonote 身份，安全登录你所有的应用。</p>

      <div class="cards">
        <NuxtLink to="/account" class="acard doodle-box card-a">
          <span class="acard-emoji">🧰</span>
          <span class="acard-text">
            <strong>账号中心</strong>
            <small>管理登录、安全和个人信息，都在一处。</small>
          </span>
          <span class="acard-arrow">→</span>
        </NuxtLink>

        <NuxtLink to="/admin" class="acard doodle-box card-b">
          <span class="acard-emoji">🛠️</span>
          <span class="acard-text">
            <strong>管理后台</strong>
            <small>配置客户端、角色，管理订阅权益。</small>
          </span>
          <span class="acard-arrow">→</span>
        </NuxtLink>
      </div>

      <div class="cta">
        <NuxtLink to="/login" class="submit doodle-box">登录 <span class="arrow">→</span></NuxtLink>
        <NuxtLink to="/register" class="signup-link">画一个新账号 ✎</NuxtLink>
      </div>
    </div>

    <div class="status">
      <span class="dot" />
      account.leeguoo.com · 端到端加密 · 凑合也很安全
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

type RefreshPayload = {
  access_token?: string
}

const config = useRuntimeConfig()

const tryResumeSession = async () => {
  let token = localStorage.getItem('sso_access_token') || ''
  if (!token) {
    try {
      const refreshData = await $fetch<RefreshPayload>(`${config.public.apiBase}/auth/refresh`, {
        method: 'POST',
        body: {},
      })
      token = refreshData?.access_token || ''
      if (token) {
        localStorage.setItem('sso_access_token', token)
      }
    } catch {
      token = ''
    }
  }
  return !!token
}

onMounted(async () => {
  if (!process.client) return
  const token = await tryResumeSession()
  if (token) {
    await navigateTo('/account')
  }
})
</script>

<style scoped>
.miso-page {
  position: relative;
  background: #fcfbf4;
  min-height: 100vh;
  overflow-x: hidden;
  color: #1a1a1a;
  font-family: 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif;
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
  border: 3px solid #1a1a1a;
  border-radius: 22px 26px 19px 24px / 24px 19px 26px 22px;
  animation: boil .44s infinite;
  pointer-events: none;
}
.card-a::before { border-width: 2.6px; border-radius: 14px 17px 12px 15px / 15px 12px 17px 14px; animation-duration: .42s; }
.card-b::before { border-width: 2.6px; border-radius: 16px 12px 15px 11px / 11px 15px 12px 16px; animation-duration: .46s; }
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

.deco { position: absolute; animation: boil .42s infinite; }
.deco-star { left: 9%; top: 13%; fill: #ffd23d; stroke: #1a1a1a; stroke-width: 1.4; animation: boil .42s infinite, drift1 6s ease-in-out infinite; }
.deco-spiral { right: 11%; top: 16%; fill: none; stroke: #ff5447; stroke-width: 2.4; stroke-linecap: round; animation: boil .42s infinite, spin 16s linear infinite; }
.deco-bolt { right: 8%; bottom: 18%; fill: #3f6fe0; stroke: #1a1a1a; stroke-width: 1.4; animation: boil .42s infinite, wiggle 2.6s ease-in-out infinite; }
.deco-cloud { left: 7%; bottom: 14%; fill: #d8f0df; stroke: #1a1a1a; stroke-width: 2; animation: boil .42s infinite, drift2 7s ease-in-out infinite; }

.wordmark { text-decoration: none; animation: rise .6s cubic-bezier(.2,.9,.3,1.4) .05s both; }
.wordmark-bob { display: inline-block; animation: bob 4s ease-in-out infinite; font-family: 'ZCOOL KuaiLe', cursive; font-size: clamp(40px, 8vw, 56px); line-height: 1; }
.wordmark-bob span { display: inline-block; }

.miso-card {
  width: 100%;
  max-width: 440px;
  margin-top: 26px;
  background: #fff;
  padding: clamp(26px, 5vw, 38px) clamp(22px, 5vw, 34px) clamp(28px, 5vw, 36px);
  border-radius: 20px;
  animation: rise .7s cubic-bezier(.2,.9,.3,1.4) .16s both;
}

.kicker { text-align: center; margin-bottom: 6px; font-family: 'Permanent Marker', cursive; font-size: 13px; color: #ff5447; letter-spacing: 1px; }
.title { font-family: 'ZCOOL KuaiLe', cursive; font-weight: 400; font-size: clamp(24px, 5.4vw, 32px); text-align: center; margin: 4px 0 0; line-height: 1.25; }
.wave { display: inline-block; animation: wiggle 1.8s ease-in-out infinite; transform-origin: 70% 70%; }
.title-underline { display: block; margin: 8px auto 0; }
.title-underline path { filter: url(#roughHi); stroke-dasharray: 250; stroke-dashoffset: 250; animation: draw 1s ease .5s forwards; }
.subtitle { text-align: center; font-size: 14px; color: #57564d; margin: 12px 0 24px; }

.cards { display: flex; flex-direction: column; gap: 14px; }
.acard {
  display: flex; align-items: center; gap: 14px; text-decoration: none; color: #1a1a1a;
  background: #fff; padding: 16px 18px; border-radius: 14px; cursor: pointer;
  transition: transform .12s;
}
.acard:hover { transform: translateY(-2px) rotate(-.6deg); }
.acard:active { transform: translateY(0) rotate(0); }
.acard-emoji { font-size: 26px; flex: none; }
.acard-text { display: flex; flex-direction: column; flex: 1; }
.acard-text strong { font-weight: 700; font-size: 15px; }
.acard-text small { color: #57564d; font-size: 12.5px; margin-top: 2px; }
.acard-arrow { font-family: 'ZCOOL KuaiLe', cursive; font-size: 20px; color: #ff5447; flex: none; }

.cta { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 24px; }
.submit {
  width: 100%; background: #ff5447; color: #fff; text-decoration: none;
  font-family: 'ZCOOL KuaiLe', cursive; font-size: 21px; padding: 14px 16px;
  border: none; border-radius: 15px; cursor: pointer;
  transition: transform .12s, background .15s;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.submit:hover { background: #ff3a2b; transform: translateY(-2px); }
.submit:active { transform: translateY(0); }
.arrow { display: inline-block; }
.signup-link { color: #3f6fe0; text-decoration: none; font-weight: 700; font-size: 13.5px; }
.signup-link:hover { text-decoration: underline; }

.status {
  margin-top: 22px; display: flex; align-items: center; gap: 9px;
  font-family: 'Permanent Marker', cursive; font-size: 12.5px; color: #8a887d;
  animation: rise .7s ease .3s both;
}
.dot { width: 9px; height: 9px; border-radius: 50%; background: #36a85b; border: 1.5px solid #1a1a1a; animation: blink 1.6s steps(1) infinite; }

@media (max-width: 640px) {
  .deco { display: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  .miso-page *:not(input) { animation-duration: .001s !important; animation-iteration-count: 1 !important; }
}
</style>
