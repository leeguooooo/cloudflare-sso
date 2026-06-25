<template>
  <div class="miso-page" data-miso>
    <svg aria-hidden="true" class="miso-filters">
      <filter id="rough0"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough1"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="rough2"><feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="12" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" /></filter>
      <filter id="roughHi"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" /></filter>
    </svg>
    <svg class="deco deco-star" viewBox="0 0 24 24" width="34" height="34"><path d="M12 1 L14.5 8.5 L22 9.5 L16 14.5 L18 22 L12 17.5 L6 22 L8 14.5 L2 9.5 L9.5 8.5 Z" /></svg>
    <svg class="deco deco-cloud" viewBox="0 0 50 30" width="50" height="30"><path d="M10 22 a7 7 0 0 1 0 -13 a9 9 0 0 1 17 -2 a7 7 0 0 1 5 15 z" /></svg>

    <NuxtLink to="/" class="wordmark"><span class="wordmark-bob">
      <span style="color:#ff5447;">m</span><span style="color:#3f6fe0;">i</span><span style="color:#36a85b;">s</span><span style="color:#e0a32a;">o</span><span style="color:#ff5447;">n</span><span style="color:#3f6fe0;">o</span><span style="color:#36a85b;">t</span><span style="color:#e0a32a;">e</span>
    </span></NuxtLink>

    <div class="miso-card doodle-box">
      <div class="kicker">✦ privacy ✦</div>
      <h1 class="title">隐私权政策</h1>
      <svg class="title-underline" width="150" height="14" viewBox="0 0 150 14" fill="none"><path d="M6 8 C 40 3, 70 3, 96 7 S 130 12, 144 7" stroke="#ffd23d" stroke-width="5" stroke-linecap="round" /></svg>
      <p class="lead">本页面说明 leeguoo Identity 在账号登录、授权与订阅场景下的数据处理规则。</p>

      <h2>我们收集的数据</h2>
      <ul>
        <li>账号基础信息：邮箱、显示名称、Locale、账号状态。</li>
        <li>登录安全信息：会话设备、IP、User-Agent、登录和登出行为日志。</li>
        <li>授权信息：租户、角色、权限、客户端应用访问范围。</li>
      </ul>
      <h2>数据用途</h2>
      <ul>
        <li>用于身份认证、单点登录和授权决策。</li>
        <li>用于安全审计、风险识别和异常会话处置。</li>
        <li>用于订阅权益计算和服务可用性保障。</li>
      </ul>
      <h2>你的控制能力</h2>
      <ul>
        <li>你可以在账号中心修改个人资料、更新密码、撤销设备会话。</li>
        <li>你可以在“数据和隐私设置”中下载账号数据快照。</li>
        <li>你可以联系 <a href="mailto:support@misonote.com">support@misonote.com</a> 提交隐私相关请求。</li>
      </ul>

      <p class="effective">生效日期：2026-03-03</p>
      <NuxtLink to="/account" class="back">← 返回账号中心</NuxtLink>
    </div>

    <div class="status"><span class="dot" />account.leeguoo.com · 端到端加密 · 凑合也很安全</div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Permanent+Marker&family=Noto+Sans+SC:wght@400;500;700&display=swap' },
  ],
})
</script>

<style scoped>
.miso-page { position: relative; background: #fcfbf4; min-height: 100vh; overflow-x: hidden; color: #1a1a1a; font-family: 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; align-items: center; padding: 48px 18px; }
.miso-filters { position: absolute; width: 0; height: 0; overflow: hidden; }
.doodle-box { position: relative; }
.doodle-box::before { content: ''; position: absolute; inset: -3px; border: 3px solid #1a1a1a; border-radius: 22px 26px 19px 24px / 24px 19px 26px 22px; animation: boil .44s infinite; pointer-events: none; }
@keyframes boil { 0%,32% { filter: url(#rough0); } 33%,65% { filter: url(#rough1); } 66%,100% { filter: url(#rough2); } }
@keyframes bob { 0%,100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-6px) rotate(1.5deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes drift1 { 0%,100% { transform: translate(0,0) rotate(0); } 50% { transform: translate(6px,-10px) rotate(12deg); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0) rotate(0); } 50% { transform: translate(-8px,7px) rotate(-12deg); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
.deco { position: absolute; }
.deco-star { left: 8%; top: 12%; fill: #ffd23d; stroke: #1a1a1a; stroke-width: 1.4; animation: boil .42s infinite, drift1 6s ease-in-out infinite; }
.deco-cloud { right: 8%; bottom: 12%; fill: #d8f0df; stroke: #1a1a1a; stroke-width: 2; animation: boil .42s infinite, drift2 7s ease-in-out infinite; }
.wordmark { text-decoration: none; animation: rise .6s cubic-bezier(.2,.9,.3,1.4) .05s both; }
.wordmark-bob { display: inline-block; animation: bob 4s ease-in-out infinite; font-family: 'ZCOOL KuaiLe', cursive; font-size: clamp(36px, 7vw, 48px); line-height: 1; }
.wordmark-bob span { display: inline-block; }
.miso-card { width: 100%; max-width: 640px; margin-top: 24px; background: #fff; padding: clamp(24px, 4vw, 34px); border-radius: 20px; animation: rise .7s cubic-bezier(.2,.9,.3,1.4) .16s both; }
.kicker { text-align: center; font-family: 'Permanent Marker', cursive; font-size: 12px; color: #ff5447; letter-spacing: 1px; }
.title { font-family: 'ZCOOL KuaiLe', cursive; font-weight: 400; font-size: clamp(24px, 5vw, 30px); text-align: center; margin: 4px 0 0; }
.title-underline { display: block; margin: 6px auto 0; }
.title-underline path { filter: url(#roughHi); stroke-dasharray: 200; stroke-dashoffset: 200; animation: draw 1s ease .5s forwards; }
.lead { text-align: center; font-size: 14px; color: #57564d; margin: 12px 0 20px; }
.miso-card h2 { font-family: 'ZCOOL KuaiLe', cursive; font-weight: 400; font-size: 18px; margin: 20px 0 8px; color: #1a1a1a; }
.miso-card ul { margin: 0; padding-left: 20px; }
.miso-card li { margin: 7px 0; font-size: 14px; line-height: 1.6; color: #2a2a2a; }
.miso-card a { color: #3f6fe0; font-weight: 600; text-decoration: none; }
.miso-card a:hover { text-decoration: underline; }
.effective { margin-top: 18px; font-size: 13px; color: #8a887d; }
.back { display: inline-block; margin-top: 10px; color: #ff5447 !important; font-weight: 700; font-size: 14px; }
.status { margin-top: 22px; display: flex; align-items: center; gap: 9px; font-family: 'Permanent Marker', cursive; font-size: 12.5px; color: #8a887d; animation: rise .7s ease .3s both; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #36a85b; border: 1.5px solid #1a1a1a; animation: blink 1.6s steps(1) infinite; }
@media (max-width: 640px) { .deco { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .miso-page * { animation-duration: .001s !important; animation-iteration-count: 1 !important; } }
</style>
