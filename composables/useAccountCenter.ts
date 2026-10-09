import type { InjectionKey } from 'vue'

/**
 * State and actions of the account center (/account). The page creates it once and provides
 * it; each section component under components/account/ injects it with useAccountCenter().
 */

export type AccountSection = 'home' | 'profile' | 'security' | 'password' | 'linked' | 'privacy' | 'share' | 'billing'

export type QuickPanel = 'sessions' | 'activity'

export type AccountCenterPayload = {
  profile: {
    sub: string
    tid: string
    gaid?: string | null
    client_id?: string | null
    email: string
    /** A linked provider (or an emailed link) confirmed the address. */
    email_verified?: boolean
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
  /** Email sending is configured (verification, email change, password reset). */
  email_enabled?: boolean
}

export type RefreshPayload = {
  access_token?: string
}

export type DeleteStep = 'idle' | 'blocked' | 'reauth' | 'confirm'

export type SignInMethodsPayload = {
  email: string
  has_password: boolean
  recent_auth: boolean
  linkable: { apple: boolean; google: boolean; github: boolean }
  methods: Array<
    | { kind: 'password'; email: string }
    | { kind: 'provider'; id: string; provider: string; email: string | null; is_private_email: boolean; email_disabled: boolean; consent_revoked: boolean; name: string | null }
  >
}

export type MergePayload = {
  id: string
  status: string
  error: string | null
  provider: string
  actionable: boolean
  other: { email: string; created_at: number; has_password: boolean; sign_in_methods: Array<{ provider: string; email: string | null }>; apps: string[] } | null
  current: { email: string; has_password: boolean } | null
  password_note: 'adopt_other_password' | 'other_password_stops' | null
  apps: Array<{ ok: boolean; code: string | null; message: string | null; data: Record<string, unknown> | null }>
}

export type MethodRow = { key: string; label: string; detail: string; action: 'unlink' | 'link' | 'password' | ''; provider: string; id?: string; isLast?: boolean }

export type AccountLang = 'zh' | 'en'

const ACCOUNT_LANG_KEY = 'sso_account_lang'

/** Saved choice first, then the browser language; Chinese when there is no window. */
const initialLang = (): AccountLang => {
  if (typeof window === 'undefined') return 'zh'
  try {
    const saved = localStorage.getItem(ACCOUNT_LANG_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const createAccountCenter = () => {
  const lang = ref<AccountLang>(initialLang())
  const tr = (zh: string, en: string) => (lang.value === 'en' ? en : zh)
  const setLang = (value: AccountLang) => {
    lang.value = value
    try {
      localStorage.setItem(ACCOUNT_LANG_KEY, value)
    } catch {}
    document.documentElement.lang = value === 'en' ? 'en' : 'zh-CN'
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
  const revokingBulk = ref('')
  const exportingData = ref(false)
  const sendingVerify = ref(false)
  const emailChangeOpen = ref(false)
  const emailChangeReauth = ref(false)
  const newEmail = ref('')
  const changingEmail = ref(false)
  const emailChangeError = ref('')

  const deleteStep = ref<DeleteStep>('idle')
  const deleteChecking = ref(false)
  const deletingAccount = ref(false)
  const deleteConfirmText = ref('')
  const deleteError = ref('')

  const profileForm = reactive({
    display_name: '',
    locale: 'en',
  })

  const passwordForm = reactive({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })

  const navItems = computed<Array<{ key: AccountSection; label: string; icon: string; color: string }>>(() => [
    { key: 'home', label: tr('首页', 'Home'), icon: '⌂', color: '#b8cdfa' },
    { key: 'profile', label: tr('个人信息', 'Personal info'), icon: '◍', color: '#a8ddb5' },
    { key: 'security', label: tr('安全性与登录', 'Security & sign-in'), icon: '⌁', color: '#9dd7ff' },
    { key: 'password', label: tr('leeguoo 密码', 'leeguoo password'), icon: '•••', color: '#8ab4f8' },
    { key: 'linked', label: tr('登录方式', 'Sign-in methods'), icon: '◎', color: '#97d5f7' },
    { key: 'privacy', label: tr('数据和隐私设置', 'Data & privacy'), icon: '◌', color: '#ccb3f7' },
    { key: 'share', label: tr('用户和分享', 'People & sharing'), icon: '◔', color: '#f6b2de' },
    { key: 'billing', label: tr('付费和订阅', 'Payments & subscriptions'), icon: '▣', color: '#f7c089' },
  ])

  const quickActions = computed<Array<{ label: string; section: AccountSection; panel?: QuickPanel }>>(() => [
    { label: tr('我的密码', 'My password'), section: 'password' },
    { label: tr('设备', 'Devices'), section: 'security', panel: 'sessions' },
    { label: tr('我的活动记录', 'My activity'), section: 'security', panel: 'activity' },
    { label: tr('通行密钥', 'Passkeys'), section: 'security' },
    { label: tr('两步验证', '2-Step Verification'), section: 'security' },
  ])

  const activeNav = computed<AccountSection>(() => {
    const section = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section
    if (typeof section === 'string' && ACCOUNT_SECTIONS.includes(section as AccountSection)) {
      return section as AccountSection
    }
    return 'home'
  })

  const activePanel = computed<QuickPanel | ''>(() => {
    const panel = Array.isArray(route.query.panel) ? route.query.panel[0] : route.query.panel
    if (panel === 'sessions' || panel === 'activity') {
      return panel
    }
    return ''
  })

  const displayName = computed(() => {
    const name = (center.value?.profile.name || '').trim()
    if (name) return name
    const email = center.value?.profile.email || ''
    if (!email) return tr('账户用户', 'Account user')
    return email.split('@')[0]
  })

  const initials = computed(() => {
    const name = displayName.value.trim()
    if (!name) return 'U'
    return name.slice(0, 1).toUpperCase()
  })

  const isAdmin = computed(() => (center.value?.profile.roles || []).some((role) => role.toLowerCase() === 'admin'))

  const roleLabel = computed(() => {
    const roles = center.value?.profile.roles || []
    return roles.length ? roles.join(', ') : 'user'
  })

  const sectionTitle = computed(() => {
    if (activeNav.value === 'profile') return tr('个人信息', 'Personal info')
    if (activeNav.value === 'security') return tr('安全性与登录', 'Security & sign-in')
    if (activeNav.value === 'password') return tr('密码设置', 'Password')
    if (activeNav.value === 'linked') return tr('登录方式', 'Sign-in methods')
    if (activeNav.value === 'privacy') return tr('数据和隐私设置', 'Data & privacy')
    if (activeNav.value === 'share') return tr('用户和分享', 'People & sharing')
    if (activeNav.value === 'billing') return tr('付费和订阅', 'Payments & subscriptions')
    return tr('账户概览', 'Account overview')
  })

  const sectionDesc = computed(() => {
    if (activeNav.value === 'profile') return tr('管理显示名称、邮箱和区域设置。', 'Manage your display name, email and locale.')
    if (activeNav.value === 'security') return tr('通行密钥、两步验证、设备会话与近期账号活动。', 'Passkeys, 2-Step Verification, device sessions and recent account activity.')
    if (activeNav.value === 'password') return tr('修改密码并管理密码安全策略。', 'Change your password and keep it secure.')
    if (activeNav.value === 'linked') return tr('绑定 Apple、Google、GitHub 或设置密码；把重复的账号合并成一个。', 'Link Apple, Google, GitHub or set a password; merge duplicate accounts into one.')
    if (activeNav.value === 'privacy') return tr('下载账号信息，或永久删除账号。', 'Download your account data, or permanently delete your account.')
    if (activeNav.value === 'share') return tr('查看跨应用会话和访问范围。', 'See your sessions and access across apps.')
    if (activeNav.value === 'billing') return tr('查看订阅与权益状态。', 'See your subscriptions and entitlements.')
    return tr('同一邮箱一次登录，可自动开通到不同应用租户。', 'Sign in once with one email and get access to every app tenant.')
  })



  const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google', github: 'GitHub' }
  const providerName = (provider: string) => PROVIDER_NAMES[provider] || provider

  const methods = ref<SignInMethodsPayload | null>(null)
  const merge = ref<MergePayload | null>(null)
  const mergeLoading = ref(false)
  const merging = ref(false)
  const mergeId = computed(() => (typeof route.query.merge === 'string' ? route.query.merge : ''))


  const methodRows = computed<MethodRow[]>(() => {
    const payload = methods.value
    if (!payload) return []
    const total = payload.methods.length
    const rows: MethodRow[] = [
      {
        key: 'password',
        label: tr('邮箱和密码', 'Email and password'),
        detail: payload.has_password ? payload.email : tr('未设置密码', 'No password set'),
        action: 'password',
        provider: 'password',
      },
    ]
    for (const provider of ['apple', 'google', 'github']) {
      const linked = payload.methods.filter((m) => m.kind === 'provider' && m.provider === provider) as Array<
        Extract<SignInMethodsPayload['methods'][number], { kind: 'provider' }>
      >
      for (const item of linked) {
        const notes = [
          item.is_private_email ? tr('隐藏邮箱', 'hidden email') : '',
          item.email_disabled ? tr('邮件转发已关闭', 'email forwarding off') : '',
          item.consent_revoked ? tr('已在 Apple 设置中停用，再次登录即可恢复', 'turned off in Apple settings; sign in again to restore') : '',
        ].filter(Boolean)
        rows.push({
          key: item.id,
          id: item.id,
          provider,
          label: providerName(provider),
          detail: tr(
            `已绑定 ${item.email || item.name || ''}${notes.length ? `（${notes.join('，')}）` : ''}`,
            `Linked ${item.email || item.name || ''}${notes.length ? ` (${notes.join(', ')})` : ''}`,
          ),
          action: 'unlink',
          isLast: total <= 1,
        })
      }
      if (!linked.length && payload.linkable[provider as 'apple' | 'google' | 'github']) {
        rows.push({ key: `link-${provider}`, provider, label: providerName(provider), detail: tr('未绑定', 'Not linked'), action: 'link' })
      }
    }
    return rows
  })

  const otherMethodsText = computed(() => {
    const other = merge.value?.other
    if (!other) return ''
    const parts = other.sign_in_methods.map((m) => `${providerName(m.provider)}${m.email ? ` ${m.email}` : ''}`)
    if (other.has_password) parts.unshift(tr(`${other.email} 的密码`, `password for ${other.email}`))
    return parts.join(tr('、', ', ')) || tr('无', 'none')
  })

  const appDataText = computed(() =>
    (merge.value?.apps || [])
      .filter((app) => app.ok && app.data)
      .map((app) => {
        const data = app.data || {}
        const name = typeof data.app === 'string' ? data.app : tr('应用', 'App')
        const clips = Number(data.clips || 0)
        const tags = Number(data.tags || 0)
        return tr(`${name}：${clips} 条记录、${tags} 个分组`, `${name}: ${clips} items, ${tags} groups`)
      })
      .join(tr('；', '; ')),
  )

  const refusedApps = computed(() =>
    (merge.value?.apps || [])
      .filter((app) => !app.ok)
      .map((app) => ({
        message:
          app.code === 'E2EE_MERGE_REFUSED'
            ? tr(
                'Pastyx：至少一个账号开启了端到端加密。加密的内容只能在你的设备上解密，服务器无法把它转到另一个账号。请先在 Pastyx 里关闭两个账号的端到端加密，再回来合并。',
                'Pastyx: end-to-end encryption is on for at least one account. Encrypted content can only be decrypted on your devices, so the server can’t move it to another account. Turn off end-to-end encryption for both accounts in Pastyx, then come back to merge.',
              )
            : app.message || tr('一个已连接的应用暂时无法合并，请稍后再试。', 'A connected app can’t be merged right now. Try again later.'),
      })),
  )

  const formatDate = (timestamp?: number | null) => (timestamp ? new Date(timestamp * 1000).toLocaleDateString(lang.value === 'en' ? 'en-US' : 'zh-CN') : '--')

  const loadMethods = async () => {
    try {
      methods.value = await withAuthFetch<SignInMethodsPayload>(`${config.public.apiBase}/account/sign-in-methods`)
    } catch {
      methods.value = null
    }
  }

  const loadMerge = async () => {
    if (!mergeId.value) {
      merge.value = null
      return
    }
    mergeLoading.value = true
    try {
      merge.value = await withAuthFetch<MergePayload>(`${config.public.apiBase}/account/merge/${encodeURIComponent(mergeId.value)}`)
    } catch (err: any) {
      notice.value = err?.data?.message || err?.message || tr('读取合并请求失败', 'Couldn’t load the merge request')
      merge.value = null
    } finally {
      mergeLoading.value = false
    }
  }

  const closeMerge = async () => {
    const nextQuery = { ...route.query }
    delete nextQuery.merge
    merge.value = null
    await router.replace({ path: route.path, query: nextQuery })
  }

  const confirmMerge = async () => {
    if (!mergeId.value) return
    merging.value = true
    notice.value = ''
    try {
      await withAuthFetch(`${config.public.apiBase}/account/merge/${encodeURIComponent(mergeId.value)}`, { method: 'POST' })
      notice.value = tr('账号已合并', 'Accounts merged')
      await Promise.all([loadMerge(), loadMethods(), loadCenter()])
    } catch (err: any) {
      notice.value = explainError(err, tr('合并失败', 'Merge failed'))
      await loadMerge()
    } finally {
      merging.value = false
    }
  }

  const cancelMerge = async () => {
    if (mergeId.value) {
      await withAuthFetch(`${config.public.apiBase}/account/merge/${encodeURIComponent(mergeId.value)}`, { method: 'DELETE' }).catch(() => undefined)
    }
    notice.value = tr('已取消合并，两个账号都保持不变', 'Merge canceled. Both accounts are unchanged.')
    await closeMerge()
  }

  const explainError = (err: any, fallback: string) => {
    const message = err?.data?.statusMessage || err?.data?.message || err?.statusMessage || err?.message || ''
    if (message === 'reauth_required') return tr('为了安全，请先点「重新验证身份」重新登录，再完成这个操作。', 'For your security, click “Verify it’s you” and sign in again, then try this again.')
    if (message === 'last_method') return tr('这是唯一的登录方式，不能移除。请先绑定其他方式或设置密码。', 'This is your only sign-in method and can’t be removed. Link another method or set a password first.')
    return message || fallback
  }

  const reauthenticate = async (continuePath = '/account?section=linked') => {
    const email = methods.value?.email || center.value?.profile.email || ''
    try {
      await $fetch(`${config.public.apiBase}/auth/logout`, { method: 'POST', body: {} })
    } finally {
      clearAccessToken()
      const query = new URLSearchParams({ continue: continuePath })
      if (email && !email.endsWith('.invalid')) query.set('email', email)
      await navigateTo(`/login?${query.toString()}`)
    }
  }

  const searchTargets = computed(() => {
    const navTargets = navItems.value.map((item) => ({
      id: `nav-${item.key}`,
      label: item.label,
      group: tr('导航', 'Navigation'),
      section: item.key,
      panel: undefined as QuickPanel | undefined,
    }))
    const actionTargets = quickActions.value.map((item, idx) => ({
      id: `quick-${idx}`,
      label: item.label,
      group: tr('快捷入口', 'Shortcuts'),
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

  const emailLinkErrors = (): Record<string, string> => ({
    invalid_or_expired_token: tr('链接无效或已过期，请重新发送。', 'The link is invalid or has expired. Send a new one.'),
    'Email already in use': tr('这个邮箱已被其他账号使用。', 'This email is already used by another account.'),
  })

  const consumeQueryNotice = async () => {
    const queryText = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
    const linked = queryText('linked')
    const linkError = queryText('link_error')
    const emailVerified = queryText('email_verified')
    const emailChanged = queryText('email_changed')
    const emailError = queryText('email_error')
    if (linked) {
      notice.value = tr(`已绑定 ${providerName(linked)}`, `Linked ${providerName(linked)}`)
    }
    if (linkError) {
      notice.value = linkError === 'reauth_required' ? explainError({ message: linkError }, '') : tr(`绑定失败：${linkError}`, `Linking failed: ${linkError}`)
    }
    if (emailVerified) notice.value = tr('邮箱已验证', 'Email verified')
    if (emailChanged) {
      const changedTo = center.value?.profile.email || tr('新邮箱', 'your new email')
      notice.value = tr(`邮箱已更改为 ${changedTo}`, `Email changed to ${changedTo}`)
    }
    if (emailError) {
      const reason = emailLinkErrors()[emailError] || emailError
      notice.value = tr(`邮箱确认失败：${reason}`, `Email confirmation failed: ${reason}`)
    }
    if (!linked && !linkError && !emailVerified && !emailChanged && !emailError) return

    const nextQuery = { ...route.query }
    for (const key of ['linked', 'link_error', 'email_verified', 'email_changed', 'email_error']) delete nextQuery[key]
    await router.replace({ path: route.path, query: nextQuery })
  }

  const isThrottled = (err: any) => Number(err?.status || err?.statusCode || err?.response?.status || 0) === 429

  const sendVerifyEmail = async () => {
    sendingVerify.value = true
    notice.value = ''
    try {
      const data = await withAuthFetch<{ ok: boolean; sent_to?: string }>(`${config.public.apiBase}/account/email/verify`, {
        method: 'POST',
        body: {},
      })
      const sentTo = data?.sent_to || center.value?.profile.email || tr('你的邮箱', 'your email')
      notice.value = tr(`验证邮件已发送到 ${sentTo}，请在邮件里点击链接完成验证`, `Verification email sent to ${sentTo}. Click the link in it to verify.`)
    } catch (err: any) {
      notice.value = isThrottled(err)
        ? tr('发送太频繁了，请稍后再试', 'Too many requests. Try again later.')
        : explainError(err, tr('发送验证邮件失败，请稍后再试', 'Couldn’t send the verification email. Try again later.'))
    } finally {
      sendingVerify.value = false
    }
  }

  const openEmailChange = () => {
    emailChangeOpen.value = true
    emailChangeReauth.value = false
    emailChangeError.value = ''
    newEmail.value = ''
  }

  const closeEmailChange = () => {
    emailChangeOpen.value = false
    emailChangeReauth.value = false
    emailChangeError.value = ''
    newEmail.value = ''
  }

  const submitEmailChange = async () => {
    const target = newEmail.value.trim()
    if (!target) return
    if (target.toLowerCase() === (center.value?.profile.email || '').toLowerCase()) {
      emailChangeError.value = tr('新邮箱和当前邮箱相同', 'The new email is the same as your current one')
      return
    }
    changingEmail.value = true
    emailChangeError.value = ''
    try {
      const data = await withAuthFetch<{ ok: boolean; sent_to?: string }>(`${config.public.apiBase}/account/email/change`, {
        method: 'POST',
        body: { new_email: target },
      })
      closeEmailChange()
      notice.value = tr(`已向 ${data?.sent_to || target} 发送确认链接，点击后生效`, `Confirmation link sent to ${data?.sent_to || target}. The change takes effect once you click it.`)
    } catch (err: any) {
      const status = Number(err?.status || err?.statusCode || err?.response?.status || 0)
      if (isReauthError(err)) {
        emailChangeReauth.value = true
      } else if (status === 409) {
        emailChangeError.value = tr('这个邮箱已被其他账号使用', 'This email is already used by another account')
      } else if (status === 429) {
        emailChangeError.value = tr('发送太频繁了，请稍后再试', 'Too many requests. Try again later.')
      } else {
        emailChangeError.value = explainError(err, tr('更改邮箱失败，请稍后再试', 'Couldn’t change your email. Try again later.'))
      }
    } finally {
      changingEmail.value = false
    }
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
      error.value = err?.data?.message || err?.message || tr('加载账户信息失败，请重新登录', 'Couldn’t load your account. Please sign in again.')
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
      notice.value = tr('没有找到匹配设置项', 'No matching settings found')
      return
    }
    goToTarget(first)
    notice.value = tr(`已跳转到：${first.label}`, `Went to: ${first.label}`)
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
      notice.value = tr('个人信息已更新', 'Personal info updated')
    } catch (err: any) {
      notice.value = err?.data?.message || err?.message || tr('保存失败', 'Save failed')
    } finally {
      savingProfile.value = false
    }
  }

  const changePassword = async () => {
    const settingFirst = Boolean(methods.value && !methods.value.has_password)
    if ((!settingFirst && !passwordForm.current_password) || !passwordForm.new_password) {
      notice.value = settingFirst ? tr('请填写新密码', 'Enter a new password') : tr('请填写当前密码和新密码', 'Enter your current and new password')
      return
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      notice.value = tr('两次输入的新密码不一致', 'The new passwords don’t match')
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
      notice.value = settingFirst
        ? tr('密码已设置，其他设备会话已撤销', 'Password set. You’ve been signed out on other devices.')
        : tr('密码已更新，其他设备会话已撤销', 'Password updated. You’ve been signed out on other devices.')
      await Promise.all([loadCenter(), loadMethods()])
    } catch (err: any) {
      notice.value = explainError(err, tr('修改密码失败', 'Couldn’t change your password'))
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

      notice.value = tr('会话已撤销', 'Session revoked')
      await loadCenter()
    } catch (err: any) {
      notice.value = err?.data?.message || err?.message || tr('撤销会话失败', 'Couldn’t revoke the session')
    } finally {
      revokingSessionId.value = ''
    }
  }

  const nowSeconds = () => Math.floor(Date.now() / 1000)

  const isRevocable = (session: AccountCenterPayload['sessions'][number]) =>
    !session.revoked_at && session.expires_at > nowSeconds()

  const otherActiveSessions = computed(() =>
    (center.value?.sessions || []).filter((session) => !session.is_current && isRevocable(session)),
  )

  // The current session is never revoked from a bulk action: that would sign this page out mid-way.
  const revocableSessionsForClient = (clientId: string) =>
    (center.value?.sessions || []).filter(
      (session) => session.client_id === clientId && !session.is_current && isRevocable(session),
    )

  const revokeSessions = async (key: string, sessionIds: string[], done: string) => {
    if (!sessionIds.length) return
    revokingBulk.value = key
    notice.value = ''
    let failed = 0
    for (const sessionId of sessionIds) {
      try {
        await withAuthFetch(`${config.public.apiBase}/account/session/revoke`, {
          method: 'POST',
          body: { session_id: sessionId },
        })
      } catch {
        failed += 1
      }
    }
    notice.value = failed ? tr(`${done}，但有 ${failed} 个会话撤销失败，请重试`, `${done}, but ${failed} sessions couldn’t be revoked. Try again.`) : done
    revokingBulk.value = ''
    await loadCenter()
  }

  const revokeOtherSessions = async () => {
    const count = otherActiveSessions.value.length
    if (!process.client || !window.confirm(tr(`退出其他 ${count} 个设备上的登录？`, `Sign out on ${count} other devices?`))) return
    await revokeSessions('others', otherActiveSessions.value.map((session) => session.id), tr('已退出其他所有设备', 'Signed out on all other devices'))
  }

  const revokeClientAccess = async (clientId: string, clientName: string) => {
    const sessions = revocableSessionsForClient(clientId)
    if (!process.client || !window.confirm(tr(`撤销 ${clientName} 的访问？该应用在 ${sessions.length} 个设备上的登录都会失效。`, `Remove access for ${clientName}? It will be signed out on ${sessions.length} devices.`))) return
    await revokeSessions(clientId, sessions.map((session) => session.id), tr(`已撤销 ${clientName} 的访问`, `Removed access for ${clientName}`))
  }

  const deleteConfirmTarget = computed(() => {
    const email = (center.value?.profile.email || '').trim()
    return email && !email.endsWith('.invalid') ? email : 'DELETE'
  })

  const deleteConfirmMatches = computed(
    () => deleteConfirmText.value.trim().toLowerCase() === deleteConfirmTarget.value.toLowerCase(),
  )

  const isReauthError = (err: any) => {
    const message = String(err?.data?.statusMessage || err?.data?.message || err?.statusMessage || err?.message || '')
    return message === 'reauth_required' || /recent sign-in/i.test(message)
  }

  const resetDeleteAccount = () => {
    deleteStep.value = 'idle'
    deleteConfirmText.value = ''
    deleteError.value = ''
  }

  const startDeleteAccount = async () => {
    deleteChecking.value = true
    deleteError.value = ''
    try {
      await withAuthFetch(`${config.public.apiBase}/account?check=1`, { method: 'DELETE' })
      deleteStep.value = 'confirm'
    } catch (err: any) {
      if (isReauthError(err)) {
        deleteStep.value = 'reauth'
      } else {
        deleteError.value = explainError(err, tr('暂时无法删除这个账号，请稍后再试', 'This account can’t be deleted right now. Try again later.'))
        deleteStep.value = 'blocked'
      }
    } finally {
      deleteChecking.value = false
    }
  }

  const confirmDeleteAccount = async () => {
    if (!deleteConfirmMatches.value) return
    deletingAccount.value = true
    deleteError.value = ''
    try {
      await withAuthFetch(`${config.public.apiBase}/account`, { method: 'DELETE' })
      clearAccessToken()
      if (process.client) localStorage.removeItem('sso_last_email')
      await navigateTo('/login')
    } catch (err: any) {
      if (isReauthError(err)) {
        deleteStep.value = 'reauth'
      } else {
        deleteError.value = explainError(err, tr('删除失败，请稍后再试', 'Delete failed. Try again later.'))
      }
    } finally {
      deletingAccount.value = false
    }
  }

  const startLinkProvider = (provider: string) => {
    if (!process.client) return
    if (methods.value && !methods.value.recent_auth) {
      notice.value = explainError({ message: 'reauth_required' }, '')
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

  const unlinkIdentity = async (row: MethodRow) => {
    if (!row.id || row.isLast) return
    unlinkingProvider.value = row.key
    notice.value = ''
    try {
      await withAuthFetch(`${config.public.apiBase}/account/linked?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      })
      notice.value = tr(`已解绑 ${row.label}`, `Unlinked ${row.label}`)
      await Promise.all([loadCenter(), loadMethods()])
    } catch (err: any) {
      notice.value = explainError(err, tr('解绑失败', 'Unlink failed'))
    } finally {
      unlinkingProvider.value = ''
    }
  }

  const downloadExport = async () => {
    if (!process.client) return
    exportingData.value = true
    try {
      // The server assembles the full export (more than this page shows).
      const data = await withAuthFetch<Record<string, unknown>>(`${config.public.apiBase}/account/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
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
      notice.value = tr('数据导出已开始', 'Export started')
    } catch (err: any) {
      notice.value = explainError(err, tr('导出失败，请稍后再试', 'Export failed. Try again later.'))
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
      return new Intl.DateTimeFormat(lang.value === 'en' ? 'en-US' : 'zh-CN', {
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

  watch(mergeId, () => {
    void loadMerge()
  })

  onMounted(() => {
    void loadCenter()
    void loadMethods()
    void loadMerge()
    document.addEventListener('click', handleDocumentClick)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick)
  })

  return {
    lang,
    tr,
    setLang,
    loading,
    error,
    notice,
    searchText,
    appsOpen,
    appsWrapRef,
    center,
    savingProfile,
    changingPassword,
    unlinkingProvider,
    revokingSessionId,
    revokingBulk,
    exportingData,
    sendingVerify,
    emailChangeOpen,
    emailChangeReauth,
    newEmail,
    changingEmail,
    emailChangeError,
    deleteStep,
    deleteChecking,
    deletingAccount,
    deleteConfirmText,
    deleteError,
    profileForm,
    passwordForm,
    navItems,
    quickActions,
    activeNav,
    activePanel,
    displayName,
    initials,
    isAdmin,
    roleLabel,
    sectionTitle,
    sectionDesc,
    providerName,
    methods,
    merge,
    mergeLoading,
    merging,
    mergeId,
    methodRows,
    otherMethodsText,
    appDataText,
    refusedApps,
    formatDate,
    loadMethods,
    loadMerge,
    closeMerge,
    confirmMerge,
    cancelMerge,
    explainError,
    reauthenticate,
    searchTargets,
    searchResults,
    resolveClientId,
    getAccessToken,
    setAccessToken,
    clearAccessToken,
    tryRefreshByCookie,
    withAuthFetch,
    populateProfileForm,
    consumeQueryNotice,
    isThrottled,
    sendVerifyEmail,
    openEmailChange,
    closeEmailChange,
    submitEmailChange,
    loadCenter,
    goSection,
    goToTarget,
    runSearch,
    toggleAppsMenu,
    handleDocumentClick,
    saveProfile,
    changePassword,
    revokeSession,
    isRevocable,
    otherActiveSessions,
    revocableSessionsForClient,
    revokeSessions,
    revokeOtherSessions,
    revokeClientAccess,
    deleteConfirmTarget,
    deleteConfirmMatches,
    isReauthError,
    resetDeleteAccount,
    startDeleteAccount,
    confirmDeleteAccount,
    startLinkProvider,
    unlinkIdentity,
    downloadExport,
    simplifyUserAgent,
    formatDateTime,
    priceText,
    logout,
  }
}

export type AccountCenter = ReturnType<typeof createAccountCenter>

const ACCOUNT_CENTER: InjectionKey<AccountCenter> = Symbol('account-center')

export const provideAccountCenter = () => {
  const center = createAccountCenter()
  provide(ACCOUNT_CENTER, center)
  return center
}

export const useAccountCenter = () => {
  const center = inject(ACCOUNT_CENTER)
  if (!center) throw new Error('useAccountCenter() outside the account center page')
  return center
}
