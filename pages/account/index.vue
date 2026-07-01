<template>
  <div class="account-shell">
    <header class="topbar">
      <div class="brand">leeguoo 账号</div>
      <div class="top-actions">
        <NuxtLink to="/help">
          <UiButton unstyled type="button" class="icon-btn" aria-label="help">?</UiButton>
        </NuxtLink>
        <div class="apps-wrap" ref="appsWrapRef">
          <UiButton
            unstyled
            type="button"
            class="icon-btn"
            aria-label="apps"
            @click="toggleAppsMenu"
          >
            ⋮
          </UiButton>
          <div v-if="appsOpen" class="apps-menu">
            <NuxtLink to="/portal" @click="appsOpen = false">用户门户</NuxtLink>
            <NuxtLink to="/admin" @click="appsOpen = false">管理后台</NuxtLink>
            <NuxtLink to="/admin/apps" @click="appsOpen = false">应用管理</NuxtLink>
            <NuxtLink to="/admin/billing" @click="appsOpen = false">订阅管理</NuxtLink>
          </div>
        </div>
        <div class="mini-avatar">
          <img
            v-if="center?.profile.avatar_url"
            :src="center?.profile.avatar_url"
            :alt="`${displayName} avatar`"
            class="mini-avatar-image"
          />
          <span v-else>{{ initials }}</span>
        </div>
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
          @click="goSection(item.key)"
        >
          <span class="pill-icon" :style="{ backgroundColor: item.color }">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </UiButton>
      </aside>

      <main class="center-panel">
        <div class="profile-block fade-in">
          <div class="hero-avatar">
            <img
              v-if="center?.profile.avatar_url"
              :src="center?.profile.avatar_url"
              :alt="`${displayName} avatar`"
              class="hero-avatar-image"
            />
            <span v-else>{{ initials }}</span>
            <span class="camera-badge">◉</span>
          </div>
          <h1>{{ displayName }}</h1>
          <p>{{ center?.profile.email || '未设置邮箱' }}</p>
        </div>

        <form class="search-wrap fade-in delay-1" @submit.prevent="runSearch">
          <span class="search-icon">⌕</span>
          <input
            v-model="searchText"
            class="search-input-field"
            placeholder="搜索账号设置（如：密码、设备、订阅）"
          />
          <UiButton unstyled type="submit" class="search-submit">搜索</UiButton>
        </form>

        <div v-if="searchText.trim()" class="search-results">
          <UiButton
            v-for="target in searchResults"
            :key="target.id"
            unstyled
            type="button"
            class="search-result-btn"
            @click="goToTarget(target)"
          >
            {{ target.label }}
            <small>{{ target.group }}</small>
          </UiButton>
          <p v-if="!searchResults.length" class="search-empty">未找到匹配项</p>
        </div>

        <div class="quick-actions fade-in delay-2">
          <UiButton
            unstyled
            type="button"
            v-for="action in quickActions"
            :key="action.label"
            class="chip"
            @click="goSection(action.section, action.panel)"
          >
            {{ action.label }}
          </UiButton>
        </div>

        <UiCard class="summary-card fade-in delay-3">
          <h2>{{ sectionTitle }}</h2>
          <p class="summary-desc">{{ sectionDesc }}</p>

          <div v-if="activeNav === 'home'" class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Tenant</span>
              <strong>{{ center?.profile.tid || '未关联' }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Global Account</span>
              <strong>{{ center?.profile.gaid || '未关联' }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Roles</span>
              <strong>{{ roleLabel }}</strong>
            </div>
          </div>

          <div v-else-if="activeNav === 'profile'" class="form-grid">
            <UiInput
              v-model="profileForm.display_name"
              label="显示名称"
              placeholder="输入显示名称"
              :disabled="savingProfile"
            />
            <UiInput
              :model-value="center?.profile.email || ''"
              label="邮箱"
              disabled
            />
            <UiInput
              v-model="profileForm.locale"
              label="Locale"
              placeholder="例如 en / zh-CN"
              :disabled="savingProfile"
            />
            <UiInput
              :model-value="center?.profile.tid || ''"
              label="租户"
              disabled
            />
            <div class="inline-actions">
              <UiButton variant="primary" :loading="savingProfile" @click="saveProfile">保存个人信息</UiButton>
            </div>
          </div>

          <div v-else-if="activeNav === 'security'" class="section-stack">
            <div v-if="activePanel !== 'activity'" class="stack-block">
              <h3>设备与会话</h3>
              <p class="block-hint">可撤销异常设备会话，保护账号安全。</p>
              <div v-if="center?.sessions.length" class="list-wrap">
                <div v-for="session in center.sessions" :key="session.id" class="list-item">
                  <div>
                    <strong>{{ session.device_label }}</strong>
                    <p>{{ session.client_name || session.client_id || 'Unknown app' }} · {{ session.ip || 'Unknown IP' }}</p>
                    <small>{{ formatDateTime(session.created_at) }} · 到期 {{ formatDateTime(session.expires_at) }}</small>
                  </div>
                  <div class="list-actions">
                    <span v-if="session.is_current" class="tag-current">当前设备</span>
                    <span v-else-if="session.revoked_at" class="tag-muted">已撤销</span>
                    <UiButton
                      v-else
                      variant="ghost"
                      size="sm"
                      :loading="revokingSessionId === session.id"
                      @click="revokeSession(session.id)"
                    >
                      撤销
                    </UiButton>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">暂无设备会话记录</p>
            </div>

            <div v-if="activePanel !== 'sessions'" class="stack-block">
              <h3>近期活动</h3>
              <p class="block-hint">最近账号行为日志（登录、刷新、登出、设置变更）。</p>
              <div v-if="center?.recent_activity.length" class="list-wrap">
                <div
                  v-for="entry in center.recent_activity.slice(0, 12)"
                  :key="`${entry.action}-${entry.created_at}`"
                  class="list-item"
                >
                  <div>
                    <strong>{{ entry.action }}</strong>
                    <p>{{ entry.ip || 'Unknown IP' }} · {{ simplifyUserAgent(entry.user_agent) }}</p>
                    <small>{{ formatDateTime(entry.created_at) }}</small>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">暂无活动记录</p>
            </div>
          </div>

          <div v-else-if="activeNav === 'password'" class="form-grid">
            <UiInput
              v-model="passwordForm.current_password"
              type="password"
              label="当前密码"
              autocomplete="current-password"
              :disabled="changingPassword"
            />
            <UiInput
              v-model="passwordForm.new_password"
              type="password"
              label="新密码"
              autocomplete="new-password"
              :disabled="changingPassword"
            />
            <UiInput
              v-model="passwordForm.confirm_password"
              type="password"
              label="确认新密码"
              autocomplete="new-password"
              :disabled="changingPassword"
            />
            <p class="block-hint">密码长度至少 8 位，修改后会自动撤销其他设备会话。</p>
            <div class="inline-actions">
              <UiButton variant="primary" :loading="changingPassword" @click="changePassword">更新密码</UiButton>
            </div>
          </div>

          <div v-else-if="activeNav === 'linked'" class="section-stack">
            <div class="stack-block">
              <h3>第三方账号</h3>
              <p class="block-hint">可绑定 Google / GitHub 作为登录方式，WeChat 正在排期。</p>
              <div class="provider-grid">
                <div v-for="provider in providerCards" :key="provider.key" class="provider-card">
                  <div>
                    <strong>{{ provider.label }}</strong>
                    <p v-if="provider.todo">待接入（TODO）</p>
                    <p v-if="provider.connected">已绑定 {{ provider.connectedEmail || provider.subject || '' }}</p>
                    <p v-else-if="!provider.todo">未绑定</p>
                  </div>
                  <div class="provider-actions">
                    <UiButton
                      v-if="provider.connected && !provider.todo"
                      variant="ghost"
                      size="sm"
                      :loading="unlinkingProvider === provider.key"
                      @click="unlinkProvider(provider.key)"
                    >
                      解绑
                    </UiButton>
                    <UiButton
                      v-else-if="!provider.todo"
                      variant="primary"
                      size="sm"
                      @click="startLinkProvider(provider.key)"
                    >
                      绑定
                    </UiButton>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activeNav === 'privacy'" class="section-stack">
            <div class="stack-block">
              <h3>数据与隐私</h3>
              <p class="block-hint">导出你当前账号中心可见的数据快照（JSON）。</p>
              <div class="summary-grid">
                <div class="summary-item">
                  <span class="summary-label">邮箱</span>
                  <strong>{{ center?.profile.email || '未设置' }}</strong>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Locale</span>
                  <strong>{{ center?.profile.locale || 'en' }}</strong>
                </div>
                <div class="summary-item">
                  <span class="summary-label">活跃权益</span>
                  <strong>{{ center?.billing.active_entitlement_keys.length || 0 }}</strong>
                </div>
              </div>
              <div class="inline-actions">
                <UiButton variant="primary" :loading="exportingData" @click="downloadExport">下载数据导出</UiButton>
              </div>
            </div>
          </div>

          <div v-else-if="activeNav === 'share'" class="section-stack">
            <div class="stack-block">
              <h3>用户与分享</h3>
              <p class="block-hint">当前账号在各应用中的会话与访问范围。</p>
              <div class="summary-grid">
                <div class="summary-item">
                  <span class="summary-label">角色</span>
                  <strong>{{ roleLabel }}</strong>
                </div>
                <div class="summary-item">
                  <span class="summary-label">应用数</span>
                  <strong>{{ center?.sharing.clients.length || 0 }}</strong>
                </div>
                <div class="summary-item">
                  <span class="summary-label">权限数</span>
                  <strong>{{ center?.profile.perms.length || 0 }}</strong>
                </div>
              </div>

              <div v-if="center?.sharing.clients.length" class="list-wrap">
                <div v-for="client in center.sharing.clients" :key="client.client_id" class="list-item">
                  <div>
                    <strong>{{ client.client_name }}</strong>
                    <p>{{ client.client_id }}</p>
                    <small>最近访问 {{ formatDateTime(client.last_seen_at) }}</small>
                  </div>
                  <div class="list-actions">
                    <span class="tag-muted">活动会话 {{ client.active_sessions }}</span>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">暂无跨应用会话记录</p>
            </div>
          </div>

          <div v-else-if="activeNav === 'billing'" class="section-stack">
            <div class="stack-block">
              <h3>付费与订阅</h3>
              <p class="block-hint">展示账号当前订阅与权益状态。</p>

              <div v-if="center?.billing.subscriptions.length" class="list-wrap">
                <div v-for="sub in center.billing.subscriptions" :key="sub.id" class="list-item">
                  <div>
                    <strong>{{ sub.plan_name }} ({{ sub.status }})</strong>
                    <p>{{ sub.product_name || sub.product_key || 'Unknown product' }} · {{ sub.currency }} {{ priceText(sub.amount_minor) }}</p>
                    <small>开始于 {{ formatDateTime(sub.started_at) }} · 周期 {{ sub.billing_cycle }}</small>
                  </div>
                </div>
              </div>
              <p v-else class="empty-text">当前无订阅记录</p>

              <div class="entitlement-wrap" v-if="center?.billing.active_entitlement_keys.length">
                <span class="summary-label">活跃权益</span>
                <div class="entitlement-list">
                  <span v-for="key in center.billing.active_entitlement_keys" :key="key" class="entitlement-chip">{{ key }}</span>
                </div>
              </div>
            </div>
          </div>
        </UiCard>

        <p v-if="notice" class="notice-text">{{ notice }}</p>

        <p class="privacy-copy">
          只有你本人可以查看你的设置。你可以在这里统一管理登录、安全、应用授权与订阅权益。
        </p>
      </main>
    </div>

    <footer class="bottom-links">
      <NuxtLink to="/privacy">隐私权</NuxtLink>
      <NuxtLink to="/terms">条款</NuxtLink>
      <NuxtLink to="/help">帮助</NuxtLink>
      <NuxtLink to="/about">关于</NuxtLink>
      <UiButton unstyled type="button" class="logout-btn" @click="logout">退出登录</UiButton>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false,
})

type AccountSection = 'home' | 'profile' | 'security' | 'password' | 'linked' | 'privacy' | 'share' | 'billing'
type QuickPanel = 'sessions' | 'activity' | 'manager' | 'email'

type AccountCenterPayload = {
  profile: {
    sub: string
    tid: string
    gaid?: string | null
    client_id?: string | null
    email: string
    locale?: string | null
    name?: string | null
    avatar_url?: string | null
    roles: string[]
    perms: string[]
    created_at?: number
  }
  linked_identities: Array<{
    provider: string
    subject: string
    email?: string | null
    created_at: number
    updated_at: number
  }>
  sessions: Array<{
    id: string
    client_id?: string | null
    client_name?: string | null
    device_label: string
    user_agent: string
    ip: string
    created_at: number
    expires_at: number
    revoked_at?: number | null
    is_current: boolean
  }>
  recent_activity: Array<{
    action: string
    ip: string
    user_agent: string
    payload: Record<string, unknown>
    created_at: number
  }>
  sharing: {
    roles: string[]
    clients: Array<{
      client_id: string
      client_name: string
      last_seen_at: number
      active_sessions: number
      session_count: number
    }>
  }
  billing: {
    subscriptions: Array<{
      id: string
      status: string
      provider: string
      provider_ref?: string | null
      started_at: number
      current_period_start?: number | null
      current_period_end?: number | null
      cancel_at_period_end: boolean
      canceled_at?: number | null
      updated_at: number
      plan_key: string
      plan_name: string
      currency: string
      amount_minor: number
      billing_cycle: string
      product_key?: string | null
      product_name?: string | null
    }>
    active_entitlement_keys: string[]
    entitlements: Array<{
      entitlement_key: string
      source: string
      status: string
      valid_from: number
      valid_to?: number | null
      revoked_at?: number | null
      subscription_id?: string | null
      updated_at: number
    }>
  }
}

type RefreshPayload = {
  access_token?: string
}

const ACCOUNT_SECTIONS: AccountSection[] = [
  'home',
  'profile',
  'security',
  'password',
  'linked',
  'privacy',
  'share',
  'billing',
]

const config = useRuntimeConfig()
const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const notice = ref('')
const searchText = ref('')
const appsOpen = ref(false)
const appsWrapRef = ref<HTMLElement | null>(null)

const center = ref<AccountCenterPayload | null>(null)

const savingProfile = ref(false)
const changingPassword = ref(false)
const unlinkingProvider = ref('')
const revokingSessionId = ref('')
const exportingData = ref(false)

const profileForm = reactive({
  display_name: '',
  locale: 'en',
})

const passwordForm = reactive({
  current_password: '',
  new_password: '',
  confirm_password: '',
})

const navItems: Array<{ key: AccountSection; label: string; icon: string; color: string }> = [
  { key: 'home', label: '首页', icon: '⌂', color: '#b8cdfa' },
  { key: 'profile', label: '个人信息', icon: '◍', color: '#a8ddb5' },
  { key: 'security', label: '安全性与登录', icon: '⌁', color: '#9dd7ff' },
  { key: 'password', label: 'leeguoo 密码', icon: '•••', color: '#8ab4f8' },
  { key: 'linked', label: '第三方关联', icon: '◎', color: '#97d5f7' },
  { key: 'privacy', label: '数据和隐私设置', icon: '◌', color: '#ccb3f7' },
  { key: 'share', label: '用户和分享', icon: '◔', color: '#f6b2de' },
  { key: 'billing', label: '付费和订阅', icon: '▣', color: '#f7c089' },
]

const quickActions: Array<{ label: string; section: AccountSection; panel?: QuickPanel }> = [
  { label: '我的密码', section: 'password' },
  { label: '设备', section: 'security', panel: 'sessions' },
  { label: '密码管理工具', section: 'password', panel: 'manager' },
  { label: '我的活动记录', section: 'security', panel: 'activity' },
  { label: '邮箱', section: 'profile', panel: 'email' },
]

const activeNav = computed<AccountSection>(() => {
  const section = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section
  if (typeof section === 'string' && ACCOUNT_SECTIONS.includes(section as AccountSection)) {
    return section as AccountSection
  }
  return 'home'
})

const activePanel = computed<QuickPanel | ''>(() => {
  const panel = Array.isArray(route.query.panel) ? route.query.panel[0] : route.query.panel
  if (panel === 'sessions' || panel === 'activity' || panel === 'manager' || panel === 'email') {
    return panel
  }
  return ''
})

const displayName = computed(() => {
  const name = (center.value?.profile.name || '').trim()
  if (name) return name
  const email = center.value?.profile.email || ''
  if (!email) return '账户用户'
  return email.split('@')[0]
})

const initials = computed(() => {
  const name = displayName.value.trim()
  if (!name) return 'U'
  return name.slice(0, 1).toUpperCase()
})

const roleLabel = computed(() => {
  const roles = center.value?.profile.roles || []
  return roles.length ? roles.join(', ') : 'user'
})

const sectionTitle = computed(() => {
  if (activeNav.value === 'profile') return '个人信息'
  if (activeNav.value === 'security') return '安全性与登录'
  if (activeNav.value === 'password') return '密码设置'
  if (activeNav.value === 'linked') return '第三方关联'
  if (activeNav.value === 'privacy') return '数据和隐私设置'
  if (activeNav.value === 'share') return '用户和分享'
  if (activeNav.value === 'billing') return '付费和订阅'
  return '账户概览'
})

const sectionDesc = computed(() => {
  if (activeNav.value === 'profile') return '管理显示名称、邮箱和区域设置。'
  if (activeNav.value === 'security') return '查看设备会话与近期账号活动。'
  if (activeNav.value === 'password') return '修改密码并管理密码安全策略。'
  if (activeNav.value === 'linked') return '绑定或解绑第三方登录账号。'
  if (activeNav.value === 'privacy') return '查看与导出账号数据。'
  if (activeNav.value === 'share') return '查看跨应用会话和访问范围。'
  if (activeNav.value === 'billing') return '查看订阅与权益状态。'
  return '同一邮箱一次登录，可自动开通到不同应用租户。'
})

const providerCards = computed(() => {
  const linkedMap = new Map((center.value?.linked_identities || []).map((item) => [item.provider, item]))
  return [
    { key: 'google', label: 'Google' },
    { key: 'github', label: 'GitHub' },
    { key: 'wechat', label: 'WeChat' },
  ].map((provider) => {
    const linked = linkedMap.get(provider.key)
    return {
      key: provider.key,
      label: provider.label,
      todo: provider.key === 'wechat',
      connected: !!linked,
      connectedEmail: linked?.email || null,
      subject: linked?.subject || null,
    }
  })
})

const searchTargets = computed(() => {
  const navTargets = navItems.map((item) => ({
    id: `nav-${item.key}`,
    label: item.label,
    group: '导航',
    section: item.key,
    panel: undefined as QuickPanel | undefined,
  }))
  const actionTargets = quickActions.map((item, idx) => ({
    id: `quick-${idx}`,
    label: item.label,
    group: '快捷入口',
    section: item.section,
    panel: item.panel,
  }))
  return [...navTargets, ...actionTargets]
})

const searchResults = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  if (!keyword) return []
  return searchTargets.value.filter((target) => target.label.toLowerCase().includes(keyword)).slice(0, 6)
})

const resolveClientId = () => {
  const clientFromProfile = center.value?.profile.client_id?.trim()
  if (clientFromProfile) return clientFromProfile

  const queryClientId = typeof route.query.client_id === 'string' ? route.query.client_id.trim() : ''
  if (queryClientId) return queryClientId

  const configuredDefault = typeof config.public.defaultClientId === 'string' ? config.public.defaultClientId.trim() : ''
  if (configuredDefault) return configuredDefault

  const hostname = process.client ? window.location.hostname.toLowerCase() : ''
  if (hostname === 'account.misonote.com' || hostname.endsWith('.misonote.com')) {
    return 'misonote-app-web'
  }
  return 'demo-web'
}

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

const withAuthFetch = async <T>(url: string, options: { method?: string; body?: Record<string, unknown> } = {}) => {
  let token = getAccessToken()
  if (!token) token = await tryRefreshByCookie()
  if (!token) {
    await navigateTo('/login')
    throw new Error('Missing access token')
  }

  try {
    return await $fetch<T>(url, {
      method: options.method,
      body: options.body,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || err?.response?.status || 0)
    if (status === 401) {
      const refreshed = await tryRefreshByCookie()
      if (!refreshed) {
        clearAccessToken()
        await navigateTo('/login')
        throw err
      }
      return await $fetch<T>(url, {
        method: options.method,
        body: options.body,
        headers: {
          authorization: `Bearer ${refreshed}`,
        },
      })
    }
    throw err
  }
}

const populateProfileForm = () => {
  profileForm.display_name = center.value?.profile.name || ''
  profileForm.locale = center.value?.profile.locale || 'en'
}

const consumeQueryNotice = async () => {
  const linked = typeof route.query.linked === 'string' ? route.query.linked : ''
  const linkError = typeof route.query.link_error === 'string' ? route.query.link_error : ''
  if (linked) {
    notice.value = `第三方账号已绑定：${linked}`
  }
  if (linkError) {
    notice.value = `第三方绑定失败：${linkError}`
  }
  if (!linked && !linkError) return

  const nextQuery = { ...route.query }
  delete nextQuery.linked
  delete nextQuery.link_error
  await router.replace({ path: route.path, query: nextQuery })
}

const loadCenter = async () => {
  loading.value = true
  error.value = ''
  try {
    const payload = await withAuthFetch<AccountCenterPayload>(`${config.public.apiBase}/account/center`)
    center.value = payload
    populateProfileForm()
    await consumeQueryNotice()
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || err?.response?.status || 0)
    if (status === 401) {
      clearAccessToken()
      await navigateTo('/login')
      return
    }
    error.value = err?.data?.message || err?.message || '加载账户信息失败，请重新登录'
  } finally {
    loading.value = false
  }
}

const goSection = (section: AccountSection, panel?: QuickPanel) => {
  const nextQuery = {
    ...route.query,
    section,
    panel: panel || undefined,
  }

  if (nextQuery.panel === undefined) {
    delete nextQuery.panel
  }

  if (activeNav.value === section && activePanel.value === (panel || '')) return
  void router.replace({ path: route.path, query: nextQuery })
}

const goToTarget = (target: { section: AccountSection; panel?: QuickPanel }) => {
  goSection(target.section, target.panel)
  searchText.value = ''
}

const runSearch = () => {
  const first = searchResults.value[0]
  if (!first) {
    notice.value = '没有找到匹配设置项'
    return
  }
  goToTarget(first)
  notice.value = `已跳转到：${first.label}`
}

const toggleAppsMenu = () => {
  appsOpen.value = !appsOpen.value
}

const handleDocumentClick = (event: MouseEvent) => {
  if (!appsOpen.value) return
  const target = event.target as Node | null
  if (!target) return
  if (appsWrapRef.value && !appsWrapRef.value.contains(target)) {
    appsOpen.value = false
  }
}

const saveProfile = async () => {
  savingProfile.value = true
  notice.value = ''
  try {
    const result = await withAuthFetch<{ profile: { email: string; locale: string; name?: string | null } }>(
      `${config.public.apiBase}/account/profile`,
      {
        method: 'PATCH',
        body: {
          display_name: profileForm.display_name,
          locale: profileForm.locale,
        },
      },
    )
    if (center.value) {
      center.value.profile.name = result.profile.name || ''
      center.value.profile.locale = result.profile.locale || 'en'
    }
    notice.value = '个人信息已更新'
  } catch (err: any) {
    notice.value = err?.data?.message || err?.message || '保存失败'
  } finally {
    savingProfile.value = false
  }
}

const changePassword = async () => {
  if (!passwordForm.current_password || !passwordForm.new_password) {
    notice.value = '请填写当前密码和新密码'
    return
  }
  if (passwordForm.new_password !== passwordForm.confirm_password) {
    notice.value = '两次输入的新密码不一致'
    return
  }

  changingPassword.value = true
  notice.value = ''
  try {
    await withAuthFetch(`${config.public.apiBase}/account/password`, {
      method: 'PUT',
      body: {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      },
    })
    passwordForm.current_password = ''
    passwordForm.new_password = ''
    passwordForm.confirm_password = ''
    notice.value = '密码已更新，其他设备会话已撤销'
    await loadCenter()
  } catch (err: any) {
    notice.value = err?.data?.message || err?.message || '修改密码失败'
  } finally {
    changingPassword.value = false
  }
}

const revokeSession = async (sessionId: string) => {
  revokingSessionId.value = sessionId
  notice.value = ''
  try {
    const data = await withAuthFetch<{ requires_relogin?: boolean }>(`${config.public.apiBase}/account/session/revoke`, {
      method: 'POST',
      body: {
        session_id: sessionId,
      },
    })

    if (data?.requires_relogin) {
      await logout()
      return
    }

    notice.value = '会话已撤销'
    await loadCenter()
  } catch (err: any) {
    notice.value = err?.data?.message || err?.message || '撤销会话失败'
  } finally {
    revokingSessionId.value = ''
  }
}

const startLinkProvider = (provider: string) => {
  if (!process.client) return
  if (provider === 'wechat') {
    notice.value = 'WeChat 登录正在排期（TODO）'
    return
  }
  const clientId = resolveClientId()
  const query = new URLSearchParams()
  query.set('provider', provider)
  query.set('client_id', clientId)
  query.set('continue', '/account?section=linked')
  query.set('intent', 'link')

  window.location.href = `${config.public.apiBase}/auth/oauth/start?${query.toString()}`
}

const unlinkProvider = async (provider: string) => {
  unlinkingProvider.value = provider
  notice.value = ''
  try {
    await withAuthFetch(`${config.public.apiBase}/account/linked?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    })
    notice.value = `已解绑 ${provider}`
    await loadCenter()
  } catch (err: any) {
    notice.value = err?.data?.message || err?.message || '解绑失败'
  } finally {
    unlinkingProvider.value = ''
  }
}

const downloadExport = async () => {
  if (!center.value || !process.client) return
  exportingData.value = true
  try {
    const blob = new Blob([JSON.stringify(center.value, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const datePart = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `identity-account-export-${datePart}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    notice.value = '数据导出已开始'
  } finally {
    exportingData.value = false
  }
}

const simplifyUserAgent = (ua: string) => {
  if (!ua) return 'Unknown browser'
  const trimmed = ua.trim()
  if (!trimmed) return 'Unknown browser'
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed
}

const formatDateTime = (timestamp?: number | null) => {
  if (!timestamp) return '--'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp * 1000))
  } catch {
    return '--'
  }
}

const priceText = (amountMinor: number) => {
  const value = Number(amountMinor || 0) / 100
  return value.toFixed(2)
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
  void loadCenter()
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<style scoped>
.account-shell {
  min-height: 100vh;
  font-family: var(--font-family-sans);
  background: var(--color-background);
  color: var(--color-text-primary);
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

.apps-wrap {
  position: relative;
}

.apps-menu {
  position: absolute;
  top: 42px;
  right: 0;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  padding: 6px;
  z-index: 20;
}

.apps-menu a {
  text-decoration: none;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: 8px 10px;
  border-radius: var(--radius-md);
}

.apps-menu a:hover {
  background: var(--color-neutral-100);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-neutral-300);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--color-neutral-50);
}

.mini-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: var(--color-primary-600);
  color: var(--color-surface);
  display: grid;
  place-items: center;
  font-weight: 600;
}

.mini-avatar-image {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  object-fit: cover;
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
  color: var(--color-text-primary);
  border-radius: var(--radius-full);
  height: 54px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  font-size: 1.02rem;
  text-align: left;
  cursor: pointer;
}

.nav-pill:hover {
  background: var(--color-neutral-100);
}

.nav-pill.active {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
}

.pill-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
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
  border-radius: var(--radius-full);
  margin: 0 auto 8px;
  background: var(--color-primary-600);
  color: var(--color-surface);
  font-size: 2.1rem;
  font-weight: 600;
  display: grid;
  place-items: center;
  position: relative;
}

.hero-avatar-image {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  object-fit: cover;
}

.camera-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-neutral-300);
  background: var(--color-surface);
  color: var(--color-text-secondary);
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
  color: var(--color-text-secondary);
}

.search-wrap {
  width: min(860px, 95%);
  margin-top: 22px;
  position: relative;
  display: flex;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
}

.search-input-field {
  width: 100%;
  height: 48px;
  border: 1px solid var(--color-neutral-300);
  border-radius: var(--radius-full);
  padding: 0 96px 0 44px;
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  background: var(--color-neutral-50);
}

.search-input-field::placeholder {
  color: var(--color-text-tertiary);
}

.search-input-field:focus {
  outline: 2px solid color-mix(in srgb, var(--color-primary-600) 30%, transparent);
  border-color: var(--color-primary-600);
}

.search-submit {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 34px;
  border-radius: var(--radius-full);
  padding: 0 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  cursor: pointer;
}

.search-submit:hover {
  background: var(--color-neutral-50);
}

.search-results {
  width: min(860px, 95%);
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.search-result-btn {
  border: 1px solid var(--color-neutral-300);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-radius: var(--radius-full);
  padding: 6px 14px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.search-result-btn:hover {
  background: var(--color-neutral-50);
}

.search-result-btn small {
  color: var(--color-text-tertiary);
  font-size: 0.76rem;
}

.search-empty {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
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
  border: 1px solid var(--color-neutral-300);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.chip:hover {
  background: var(--color-neutral-50);
}

.summary-card {
  margin-top: 22px;
  width: min(860px, 95%);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
  padding: 24px;
}

.summary-desc {
  margin: 8px 0 12px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.summary-item {
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  padding: 12px;
}

.summary-label {
  color: var(--color-text-tertiary);
  font-size: 0.82rem;
  display: block;
  margin-bottom: 6px;
}

.form-grid {
  display: grid;
  gap: 12px;
}

.inline-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 4px;
}

.section-stack {
  display: grid;
  gap: 14px;
}

.stack-block {
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.stack-block h3 {
  margin: 0;
  font-weight: 500;
  font-size: var(--font-size-base);
}

.block-hint {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.list-wrap {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.list-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-md);
  background: var(--color-neutral-50);
}

.list-item p,
.list-item small {
  margin: 2px 0 0;
  color: var(--color-text-tertiary);
}

.list-item p {
  font-size: var(--font-size-sm);
}

.list-item small {
  font-size: 0.78rem;
}

.list-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tag-current,
.tag-muted {
  font-size: 0.76rem;
  padding: 4px 8px;
  border-radius: var(--radius-full);
}

.tag-current {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  border: 1px solid var(--color-primary-100);
}

.tag-muted {
  background: var(--color-neutral-100);
  color: var(--color-text-secondary);
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.provider-card {
  background: var(--color-surface);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.provider-card p {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}

.provider-actions {
  display: flex;
  align-items: center;
}

.entitlement-wrap {
  margin-top: 12px;
}

.entitlement-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.entitlement-chip {
  border-radius: var(--radius-full);
  padding: 2px 12px;
  border: 1px solid var(--color-primary-100);
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-size: 0.8rem;
}

.empty-text {
  margin-top: 10px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.notice-text {
  width: min(860px, 95%);
  margin-top: 14px;
  border: 1px solid var(--color-primary-100);
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: var(--font-size-sm);
}

.privacy-copy {
  width: min(860px, 95%);
  margin-top: 18px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.bottom-links {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 24px 16px;
  font-size: 0.82rem;
}

.bottom-links a {
  color: var(--color-text-secondary);
  text-decoration: none;
}

.bottom-links a:hover {
  color: var(--color-text-primary);
}

.logout-btn {
  margin-left: auto;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  height: 34px;
  padding: 0 14px;
  cursor: pointer;
}

.logout-btn:hover {
  background: var(--color-neutral-50);
}

.state-text {
  padding: 24px;
}

.state-text.error {
  color: var(--color-danger);
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

  .provider-grid {
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
