<template>
  <div class="account-shell">
    <header class="topbar">
      <div class="brand">leeguoo 账号</div>
      <div class="top-actions">
        <UiButton unstyled type="button" class="icon-btn" aria-label="help">?</UiButton>
        <UiButton unstyled type="button" class="icon-btn" aria-label="apps">⋮</UiButton>
        <div class="mini-avatar">{{ initials }}</div>
      </div>
    </header>

    <div v-if="loading" class="state-text">正在加载账户信息...</div>
    <div v-else-if="error" class="state-text error">{{ error }}</div>

    <div v-else class="body-wrap">
      <aside class="left-nav">
        <UiButton
          v-for="item in navItems"
          :key="item.key"
          unstyled
          type="button"
          class="nav-pill"
          :class="{ active: activeNav === item.key }"
          @click="activeNav = item.key"
        >
          <span class="pill-icon" :style="{ backgroundColor: item.color }">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </UiButton>
      </aside>

      <main class="center-panel">
        <div class="profile-block fade-in">
          <div class="hero-avatar">
            {{ initials }}
            <span class="camera-badge">◉</span>
          </div>
          <h1>{{ displayName }}</h1>
          <p>{{ profile?.email || '-' }}</p>
        </div>

        <div class="search-wrap fade-in delay-1">
          <span class="search-icon">⌕</span>
          <UiInput
            v-model="searchText"
            class="search-input-field"
            placeholder="搜索 leeguoo 账号"
          />
        </div>

        <div class="quick-actions fade-in delay-2">
          <UiButton unstyled type="button" v-for="action in quickActions" :key="action" class="chip">{{ action }}</UiButton>
        </div>

        <UiCard class="summary-card fade-in delay-3">
          <h2>{{ activeSection.title }}</h2>
          <p class="summary-desc">{{ activeSection.desc }}</p>
          <div class="summary-grid">
            <div v-for="item in activeSection.meta" :key="item.label" class="summary-item">
              <span class="summary-label">{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </UiCard>

        <p class="privacy-copy">
          只有你本人可以查看你的设置。你可以在这里统一管理登录、安全、应用授权与订阅权益。
        </p>
      </main>
    </div>

    <footer class="bottom-links">
      <a href="#">隐私权</a>
      <a href="#">条款</a>
      <a href="#">帮助</a>
      <a href="#">关于</a>
      <UiButton unstyled type="button" class="logout-btn" @click="logout">退出登录</UiButton>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false,
})

type UserInfoPayload = {
  sub: string
  gaid?: string
  email: string
  locale?: string
  tid: string
  roles?: string[]
  perms?: string[]
}

type RefreshPayload = {
  access_token?: string
}

const config = useRuntimeConfig()
const loading = ref(true)
const error = ref('')
const searchText = ref('')
const activeNav = ref('home')
const profile = ref<UserInfoPayload | null>(null)

const navItems = [
  { key: 'home', label: '首页', icon: '⌂', color: '#b8cdfa' },
  { key: 'profile', label: '个人信息', icon: '◍', color: '#a8ddb5' },
  { key: 'security', label: '安全性与登录', icon: '⌁', color: '#9dd7ff' },
  { key: 'password', label: 'leeguoo 密码', icon: '•••', color: '#8ab4f8' },
  { key: 'linked', label: '第三方关联', icon: '◎', color: '#97d5f7' },
  { key: 'privacy', label: '数据和隐私设置', icon: '◌', color: '#ccb3f7' },
  { key: 'share', label: '用户和分享', icon: '◔', color: '#f6b2de' },
  { key: 'billing', label: '付费和订阅', icon: '▣', color: '#f7c089' },
]

const quickActions = ['我的密码', '设备', '密码管理工具', '我的活动记录', '邮箱']

const displayName = computed(() => {
  const email = profile.value?.email || ''
  if (!email) return '账户用户'
  return email.split('@')[0]
})

const initials = computed(() => {
  const name = displayName.value.trim()
  if (!name) return 'U'
  return name.slice(0, 1).toUpperCase()
})

const roleLabel = computed(() => {
  const roles = profile.value?.roles || []
  return roles.length ? roles.join(', ') : 'user'
})

const activeSection = computed(() => {
  const tid = profile.value?.tid || '-'
  const locale = profile.value?.locale || '-'
  const gaid = profile.value?.gaid || '-'

  if (activeNav.value === 'security') {
    return {
      title: '安全性与登录',
      desc: '集中查看登录来源与当前身份凭据状态。',
      meta: [
        { label: '登录方式', value: '邮箱 + 密码' },
        { label: 'Token 策略', value: 'Cookie + Bearer' },
        { label: '当前角色', value: roleLabel.value },
      ],
    }
  }
  if (activeNav.value === 'privacy') {
    return {
      title: '数据和隐私设置',
      desc: '这里展示当前账户在统一身份系统中的基础资料。',
      meta: [
        { label: '邮箱', value: profile.value?.email || '-' },
        { label: 'Locale', value: locale },
        { label: 'Global Account', value: gaid },
      ],
    }
  }
  if (activeNav.value === 'billing') {
    return {
      title: '付费和订阅',
      desc: '订阅中心与 billing admin 模块已联动，后续补充运营能力。',
      meta: [
        { label: '当前租户', value: tid },
        { label: '账户等级', value: 'Phase-1' },
        { label: '结算状态', value: '已接基础能力' },
      ],
    }
  }
  return {
    title: '账户概览',
    desc: '同一邮箱一次登录，可自动开通到不同应用租户。',
    meta: [
      { label: 'Tenant', value: tid },
      { label: 'Roles', value: roleLabel.value },
      { label: 'Global Account', value: gaid },
    ],
  }
})

const getAccessToken = () => {
  if (!process.client) return ''
  return localStorage.getItem('sso_access_token') || ''
}

const setAccessToken = (token: string) => {
  if (!process.client || !token) return
  localStorage.setItem('sso_access_token', token)
}

const clearAccessToken = () => {
  if (!process.client) return
  localStorage.removeItem('sso_access_token')
}

const tryRefreshByCookie = async () => {
  try {
    const data = await $fetch<RefreshPayload>(`${config.public.apiBase}/auth/refresh`, {
      method: 'POST',
      body: {},
    })
    const token = data?.access_token || ''
    if (token) setAccessToken(token)
    return token
  } catch {
    return ''
  }
}

const loadProfile = async () => {
  loading.value = true
  error.value = ''

  let token = getAccessToken()
  if (!token) token = await tryRefreshByCookie()
  if (!token) {
    loading.value = false
    await navigateTo('/login')
    return
  }

  try {
    const data = await $fetch<UserInfoPayload>(`${config.public.apiBase}/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
    })
    profile.value = data
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || '加载账户信息失败，请重新登录'
    clearAccessToken()
  } finally {
    loading.value = false
  }
}

const logout = async () => {
  try {
    await $fetch(`${config.public.apiBase}/auth/logout`, {
      method: 'POST',
      body: {},
    })
  } finally {
    clearAccessToken()
    await navigateTo('/login')
  }
}

onMounted(() => {
  loadProfile()
})
</script>

<style scoped>
.account-shell {
  min-height: 100vh;
  font-family: 'Google Sans', 'Noto Sans SC', 'Segoe UI', sans-serif;
  background: radial-gradient(circle at 10% 0%, #e6ebf3 0%, #dfe4ed 45%, #d8dde8 100%);
  color: #202124;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: clamp(1.45rem, 2.3vw, 2.25rem);
  font-weight: 500;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 9999px;
  border: 1px solid #bbc3d1;
  background: #edf1f8;
  color: #3c4043;
  cursor: pointer;
}

.mini-avatar {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #60739e, #3f5278);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 600;
}

.body-wrap {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 10px 24px 22px;
}

.left-nav {
  width: 248px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-pill {
  border: none;
  background: transparent;
  border-radius: 9999px;
  height: 54px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  font-size: 1.02rem;
  text-align: left;
  cursor: pointer;
}

.nav-pill.active {
  background: #edf2fb;
}

.pill-icon {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  font-size: 0.95rem;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
}

.profile-block {
  text-align: center;
}

.hero-avatar {
  width: 96px;
  height: 96px;
  border-radius: 9999px;
  margin: 0 auto 8px;
  background: linear-gradient(135deg, #9db2d7, #6078ad);
  color: #fff;
  font-size: 2.1rem;
  font-weight: 600;
  display: grid;
  place-items: center;
  position: relative;
}

.camera-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: 1px solid #c8d0df;
  background: #fff;
  color: #4e5769;
  font-size: 0.85rem;
  display: grid;
  place-items: center;
}

.profile-block h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 500;
}

.profile-block p {
  margin: 4px 0 0;
  font-size: clamp(1rem, 2vw, 1.5rem);
  color: #3c4043;
}

.search-wrap {
  width: min(860px, 95%);
  margin-top: 22px;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #5f6368;
}

.search-input-field {
  width: 100%;
}

.search-input-field :deep(input) {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 9999px;
  padding: 0 20px 0 44px;
  font-size: 1.05rem;
  background: #f2f4f8;
}

.quick-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
  justify-content: center;
}

.chip {
  height: 34px;
  padding: 0 14px;
  border: 1px solid #9aa0a6;
  border-radius: 10px;
  background: #f6f7f8;
  font-size: 0.95rem;
  cursor: pointer;
}

.summary-card {
  margin-top: 22px;
  width: min(860px, 95%);
  border-radius: 16px;
  background: #f4f6fa;
  border: 1px solid #cad0dc;
  padding: 16px;
}

.summary-desc {
  margin: 8px 0 12px;
  color: #4c5566;
  font-size: 0.92rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.summary-item {
  background: #fff;
  border: 1px solid #d7ddea;
  border-radius: 12px;
  padding: 12px;
}

.summary-label {
  color: #5f6368;
  font-size: 0.82rem;
  display: block;
  margin-bottom: 6px;
}

.privacy-copy {
  width: min(860px, 95%);
  margin-top: 18px;
  font-size: 0.87rem;
}

.bottom-links {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 24px 16px;
  font-size: 0.82rem;
}

.bottom-links a {
  color: #3c4043;
  text-decoration: none;
}

.logout-btn {
  margin-left: auto;
  border: 1px solid #b5becd;
  background: #eef2f8;
  color: #3c4043;
  border-radius: 8px;
  height: 34px;
  padding: 0 14px;
  cursor: pointer;
}

.state-text {
  padding: 24px;
}

.state-text.error {
  color: #b3261e;
}

.fade-in {
  opacity: 0;
  transform: translateY(10px);
  animation: fadeIn 480ms ease forwards;
}

.delay-1 {
  animation-delay: 120ms;
}

.delay-2 {
  animation-delay: 220ms;
}

.delay-3 {
  animation-delay: 320ms;
}

@keyframes fadeIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 980px) {
  .body-wrap {
    flex-direction: column;
    gap: 14px;
  }
  .left-nav {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .summary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .topbar {
    padding: 0 14px;
  }
  .body-wrap {
    padding: 10px 14px 16px;
  }
  .left-nav {
    grid-template-columns: 1fr;
  }
  .bottom-links {
    padding: 12px 14px 16px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .logout-btn {
    margin-left: 0;
  }
}
</style>
