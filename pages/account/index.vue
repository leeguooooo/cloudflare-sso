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
            v-if="isAdmin"
            unstyled
            type="button"
            class="icon-btn"
            aria-label="apps"
            @click="toggleAppsMenu"
          >
            ⋮
          </UiButton>
          <div v-if="appsOpen && isAdmin" class="apps-menu">
            <NuxtLink to="/portal" @click="appsOpen = false">用户门户</NuxtLink>
            <NuxtLink to="/admin" @click="appsOpen = false">管理后台</NuxtLink>
            <NuxtLink to="/admin/users" @click="appsOpen = false">用户管理</NuxtLink>
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
            <div class="email-field">
              <UiInput
                :model-value="center?.profile.email || ''"
                label="邮箱"
                disabled
              />
              <div class="email-meta">
                <UiBadge
                  :variant="center?.profile.email_verified ? 'success' : 'neutral'"
                  :label="center?.profile.email_verified ? '已验证' : '未验证'"
                />
                <UiButton
                  v-if="center?.email_enabled && !center?.profile.email_verified"
                  variant="ghost"
                  size="sm"
                  :loading="sendingVerify"
                  @click="sendVerifyEmail"
                >
                  发送验证邮件
                </UiButton>
                <UiButton
                  v-if="center?.email_enabled && !emailChangeOpen"
                  variant="ghost"
                  size="sm"
                  @click="openEmailChange"
                >
                  更改邮箱
                </UiButton>
              </div>
              <div v-if="emailChangeOpen" class="email-change">
                <UiInput
                  v-model="newEmail"
                  label="新邮箱"
                  type="email"
                  placeholder="you@example.com"
                  autocomplete="email"
                  :disabled="changingEmail"
                />
                <p class="block-hint">我们会向新邮箱发送确认链接，点击后才会生效；在此之前仍使用当前邮箱登录。</p>
                <template v-if="emailChangeReauth">
                  <p class="merge-refusal">为了安全，更改邮箱前需要你重新登录一次。</p>
                  <div class="inline-actions">
                    <UiButton variant="primary" size="sm" @click="reauthenticate('/account?section=profile')">重新登录</UiButton>
                    <UiButton variant="ghost" size="sm" @click="closeEmailChange">取消</UiButton>
                  </div>
                </template>
                <template v-else>
                  <p v-if="emailChangeError" class="merge-refusal">{{ emailChangeError }}</p>
                  <div class="inline-actions">
                    <UiButton variant="primary" size="sm" :loading="changingEmail" :disabled="!newEmail.trim()" @click="submitEmailChange">发送确认链接</UiButton>
                    <UiButton variant="ghost" size="sm" :disabled="changingEmail" @click="closeEmailChange">取消</UiButton>
                  </div>
                </template>
              </div>
            </div>
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
              <div v-if="otherActiveSessions.length" class="inline-actions">
                <UiButton variant="ghost" size="sm" :loading="revokingBulk === 'others'" @click="revokeOtherSessions">
                  退出其他所有设备（{{ otherActiveSessions.length }}）
                </UiButton>
              </div>
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
            <p v-if="methods && !methods.has_password" class="block-hint">
              这个账号是通过第三方登录创建的，还没有密码。设置后可以用 {{ methods.email }} 和密码登录。
            </p>
            <UiInput
              v-if="!methods || methods.has_password"
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
              <UiButton variant="primary" :loading="changingPassword" @click="changePassword">{{ methods && !methods.has_password ? '设置密码' : '更新密码' }}</UiButton>
            </div>
          </div>

          <div v-else-if="activeNav === 'linked'" class="section-stack">
            <!-- merge proposal: the provider just linked already belonged to another account -->
            <div v-if="mergeId" class="stack-block merge-block">
              <h3>合并账号</h3>
              <p v-if="mergeLoading" class="block-hint">正在读取另一个账号的信息…</p>
              <template v-else-if="merge">
                <template v-if="merge.status === 'done'">
                  <p class="block-hint">两个账号已经合并，之后用任意一种登录方式都会进入这个账号。</p>
                  <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">好的</UiButton></div>
                </template>
                <template v-else-if="!merge.actionable">
                  <p class="block-hint">{{ merge.status === 'refused' ? (merge.error || '无法合并这两个账号。') : '这个合并请求已经过期。如需合并，请重新绑定该登录方式。' }}</p>
                  <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">关闭</UiButton></div>
                </template>
                <template v-else>
                  <p class="block-hint">
                    你刚刚验证的 {{ providerName(merge.provider) }} 账号已经属于另一个 leeguoo 账号
                    <strong>{{ merge.other?.email }}</strong>（创建于 {{ formatDate(merge.other?.created_at) }}）。
                    确认这两个账号都是你的，就可以把它合并到当前账号 <strong>{{ merge.current?.email }}</strong>。
                  </p>
                  <ul class="merge-list">
                    <li>另一个账号的登录方式会转到当前账号：{{ otherMethodsText }}。</li>
                    <li>它在已连接应用中的数据会合并到当前账号<span v-if="appDataText">（{{ appDataText }}）</span>；同名分组会合并成一个，收藏和已删除记录保持原样。</li>
                    <li v-if="merge.password_note === 'adopt_other_password'">当前账号还没有密码：合并后可以用 {{ merge.other?.email }} 和它原来的密码登录这个账号。</li>
                    <li v-else-if="merge.password_note === 'other_password_stops'">两个账号都有密码：合并后 {{ merge.other?.email }} 的邮箱密码登录会停用，请用当前账号的方式登录。</li>
                    <li>另一个账号随后会被删除，并在所有设备上退出登录。此操作无法撤销。</li>
                  </ul>
                  <p v-for="(app, index) in refusedApps" :key="index" class="merge-refusal">{{ app.message }}</p>
                  <p v-if="merge.status === 'failed' && merge.error" class="merge-refusal">上次合并没有完成：{{ merge.error }}。可以重试，已完成的部分不会重复执行。</p>
                  <div class="inline-actions">
                    <UiButton variant="primary" :loading="merging" :disabled="refusedApps.length > 0" @click="confirmMerge">
                      {{ merge.status === 'failed' ? '重试合并' : '确认合并' }}
                    </UiButton>
                    <UiButton variant="ghost" :disabled="merging" @click="cancelMerge">取消</UiButton>
                  </div>
                </template>
              </template>
            </div>

            <div class="stack-block">
              <h3>登录方式</h3>
              <p class="block-hint">下面任意一种方式都能登录这个账号，至少要保留一种。</p>
              <div v-if="methods && !methods.recent_auth" class="reauth-row">
                <span>为了安全，绑定、解绑、设置密码前需要你在 15 分钟内登录过。</span>
                <UiButton variant="ghost" size="sm" @click="reauthenticate()">重新验证身份</UiButton>
              </div>
              <div class="list-wrap">
                <div v-for="row in methodRows" :key="row.key" class="list-item">
                  <div>
                    <strong>{{ row.label }}</strong>
                    <p>{{ row.detail }}</p>
                  </div>
                  <div class="list-actions">
                    <UiButton
                      v-if="row.action === 'unlink'"
                      variant="ghost"
                      size="sm"
                      :disabled="row.isLast"
                      :title="row.isLast ? '这是唯一的登录方式，不能移除' : ''"
                      :loading="unlinkingProvider === row.key"
                      @click="unlinkIdentity(row)"
                    >
                      解绑
                    </UiButton>
                    <UiButton v-else-if="row.action === 'link'" variant="primary" size="sm" @click="startLinkProvider(row.provider)">
                      绑定
                    </UiButton>
                    <UiButton v-else-if="row.action === 'password'" variant="ghost" size="sm" @click="goSection('password')">
                      {{ methods?.has_password ? '修改密码' : '设置密码' }}
                    </UiButton>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activeNav === 'privacy'" class="section-stack">
            <div class="stack-block">
              <h3>数据与隐私</h3>
              <p class="block-hint">下载你的账号信息：资料、登录方式、会话、活动记录、订阅与权益，JSON 格式。各应用里的内容（如剪贴板记录）不包含在内。</p>
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
                <UiButton variant="primary" :loading="exportingData" @click="downloadExport">下载账号信息 (JSON)</UiButton>
              </div>
            </div>

            <div class="stack-block danger-block">
              <h3>删除账号</h3>
              <p class="block-hint">
                永久删除这个 leeguoo 账号：所有登录方式、会话和各应用中的账号都会被删除，所有设备都会退出登录。此操作无法撤销。
              </p>
              <template v-if="deleteStep === 'idle'">
                <div class="inline-actions">
                  <UiButton variant="ghost" :loading="deleteChecking" @click="startDeleteAccount">删除账号…</UiButton>
                </div>
              </template>
              <template v-else-if="deleteStep === 'blocked'">
                <p class="merge-refusal">{{ deleteError }}</p>
                <div class="inline-actions">
                  <UiButton variant="ghost" size="sm" @click="resetDeleteAccount">好的</UiButton>
                </div>
              </template>
              <template v-else-if="deleteStep === 'reauth'">
                <p class="merge-refusal">为了安全，删除账号前需要你重新登录一次。</p>
                <div class="inline-actions">
                  <UiButton variant="primary" size="sm" @click="reauthenticate('/account?section=privacy')">重新登录</UiButton>
                  <UiButton variant="ghost" size="sm" @click="resetDeleteAccount">取消</UiButton>
                </div>
              </template>
              <template v-else>
                <UiInput
                  v-model="deleteConfirmText"
                  :label="`请输入 ${deleteConfirmTarget} 以确认删除`"
                  autocomplete="off"
                  :disabled="deletingAccount"
                />
                <p v-if="deleteError" class="merge-refusal">{{ deleteError }}</p>
                <div class="inline-actions">
                  <UiButton
                    variant="primary"
                    :loading="deletingAccount"
                    :disabled="!deleteConfirmMatches"
                    @click="confirmDeleteAccount"
                  >
                    永久删除账号
                  </UiButton>
                  <UiButton variant="ghost" :disabled="deletingAccount" @click="resetDeleteAccount">取消</UiButton>
                </div>
              </template>
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
                    <UiButton
                      v-if="revocableSessionsForClient(client.client_id).length"
                      variant="ghost"
                      size="sm"
                      :loading="revokingBulk === client.client_id"
                      @click="revokeClientAccess(client.client_id, client.client_name)"
                    >
                      撤销访问
                    </UiButton>
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
type QuickPanel = 'sessions' | 'activity'

type AccountCenterPayload = {
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
const revokingBulk = ref('')
const exportingData = ref(false)
const sendingVerify = ref(false)
const emailChangeOpen = ref(false)
const emailChangeReauth = ref(false)
const newEmail = ref('')
const changingEmail = ref(false)
const emailChangeError = ref('')

type DeleteStep = 'idle' | 'blocked' | 'reauth' | 'confirm'
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

const navItems: Array<{ key: AccountSection; label: string; icon: string; color: string }> = [
  { key: 'home', label: '首页', icon: '⌂', color: '#b8cdfa' },
  { key: 'profile', label: '个人信息', icon: '◍', color: '#a8ddb5' },
  { key: 'security', label: '安全性与登录', icon: '⌁', color: '#9dd7ff' },
  { key: 'password', label: 'leeguoo 密码', icon: '•••', color: '#8ab4f8' },
  { key: 'linked', label: '登录方式', icon: '◎', color: '#97d5f7' },
  { key: 'privacy', label: '数据和隐私设置', icon: '◌', color: '#ccb3f7' },
  { key: 'share', label: '用户和分享', icon: '◔', color: '#f6b2de' },
  { key: 'billing', label: '付费和订阅', icon: '▣', color: '#f7c089' },
]

const quickActions: Array<{ label: string; section: AccountSection; panel?: QuickPanel }> = [
  { label: '我的密码', section: 'password' },
  { label: '设备', section: 'security', panel: 'sessions' },
  { label: '我的活动记录', section: 'security', panel: 'activity' },
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
  if (panel === 'sessions' || panel === 'activity') {
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

const isAdmin = computed(() => (center.value?.profile.roles || []).some((role) => role.toLowerCase() === 'admin'))

const roleLabel = computed(() => {
  const roles = center.value?.profile.roles || []
  return roles.length ? roles.join(', ') : 'user'
})

const sectionTitle = computed(() => {
  if (activeNav.value === 'profile') return '个人信息'
  if (activeNav.value === 'security') return '安全性与登录'
  if (activeNav.value === 'password') return '密码设置'
  if (activeNav.value === 'linked') return '登录方式'
  if (activeNav.value === 'privacy') return '数据和隐私设置'
  if (activeNav.value === 'share') return '用户和分享'
  if (activeNav.value === 'billing') return '付费和订阅'
  return '账户概览'
})

const sectionDesc = computed(() => {
  if (activeNav.value === 'profile') return '管理显示名称、邮箱和区域设置。'
  if (activeNav.value === 'security') return '查看设备会话与近期账号活动。'
  if (activeNav.value === 'password') return '修改密码并管理密码安全策略。'
  if (activeNav.value === 'linked') return '绑定 Apple、Google、GitHub 或设置密码；把重复的账号合并成一个。'
  if (activeNav.value === 'privacy') return '下载账号信息，或永久删除账号。'
  if (activeNav.value === 'share') return '查看跨应用会话和访问范围。'
  if (activeNav.value === 'billing') return '查看订阅与权益状态。'
  return '同一邮箱一次登录，可自动开通到不同应用租户。'
})

type SignInMethodsPayload = {
  email: string
  has_password: boolean
  recent_auth: boolean
  linkable: { apple: boolean; google: boolean; github: boolean }
  methods: Array<
    | { kind: 'password'; email: string }
    | { kind: 'provider'; id: string; provider: string; email: string | null; is_private_email: boolean; email_disabled: boolean; consent_revoked: boolean; name: string | null }
  >
}

type MergePayload = {
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

const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google', github: 'GitHub' }
const providerName = (provider: string) => PROVIDER_NAMES[provider] || provider

const methods = ref<SignInMethodsPayload | null>(null)
const merge = ref<MergePayload | null>(null)
const mergeLoading = ref(false)
const merging = ref(false)
const mergeId = computed(() => (typeof route.query.merge === 'string' ? route.query.merge : ''))

type MethodRow = { key: string; label: string; detail: string; action: 'unlink' | 'link' | 'password' | ''; provider: string; id?: string; isLast?: boolean }

const methodRows = computed<MethodRow[]>(() => {
  const payload = methods.value
  if (!payload) return []
  const total = payload.methods.length
  const rows: MethodRow[] = [
    {
      key: 'password',
      label: '邮箱和密码',
      detail: payload.has_password ? payload.email : '未设置密码',
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
        item.is_private_email ? '隐藏邮箱' : '',
        item.email_disabled ? '邮件转发已关闭' : '',
        item.consent_revoked ? '已在 Apple 设置中停用，再次登录即可恢复' : '',
      ].filter(Boolean)
      rows.push({
        key: item.id,
        id: item.id,
        provider,
        label: providerName(provider),
        detail: `已绑定 ${item.email || item.name || ''}${notes.length ? `（${notes.join('，')}）` : ''}`,
        action: 'unlink',
        isLast: total <= 1,
      })
    }
    if (!linked.length && payload.linkable[provider as 'apple' | 'google' | 'github']) {
      rows.push({ key: `link-${provider}`, provider, label: providerName(provider), detail: '未绑定', action: 'link' })
    }
  }
  return rows
})

const otherMethodsText = computed(() => {
  const other = merge.value?.other
  if (!other) return ''
  const parts = other.sign_in_methods.map((m) => `${providerName(m.provider)}${m.email ? ` ${m.email}` : ''}`)
  if (other.has_password) parts.unshift(`${other.email} 的密码`)
  return parts.join('、') || '无'
})

const appDataText = computed(() =>
  (merge.value?.apps || [])
    .filter((app) => app.ok && app.data)
    .map((app) => {
      const data = app.data || {}
      const name = typeof data.app === 'string' ? data.app : '应用'
      const clips = Number(data.clips || 0)
      const tags = Number(data.tags || 0)
      return `${name}：${clips} 条记录、${tags} 个分组`
    })
    .join('；'),
)

const refusedApps = computed(() =>
  (merge.value?.apps || [])
    .filter((app) => !app.ok)
    .map((app) => ({
      message:
        app.code === 'E2EE_MERGE_REFUSED'
          ? 'Pastyx：至少一个账号开启了端到端加密。加密的内容只能在你的设备上解密，服务器无法把它转到另一个账号。请先在 Pastyx 里关闭两个账号的端到端加密，再回来合并。'
          : app.message || '一个已连接的应用暂时无法合并，请稍后再试。',
    })),
)

const formatDate = (timestamp?: number | null) => (timestamp ? new Date(timestamp * 1000).toLocaleDateString('zh-CN') : '--')

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
    notice.value = err?.data?.message || err?.message || '读取合并请求失败'
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
    notice.value = '账号已合并'
    await Promise.all([loadMerge(), loadMethods(), loadCenter()])
  } catch (err: any) {
    notice.value = explainError(err, '合并失败')
    await loadMerge()
  } finally {
    merging.value = false
  }
}

const cancelMerge = async () => {
  if (mergeId.value) {
    await withAuthFetch(`${config.public.apiBase}/account/merge/${encodeURIComponent(mergeId.value)}`, { method: 'DELETE' }).catch(() => undefined)
  }
  notice.value = '已取消合并，两个账号都保持不变'
  await closeMerge()
}

const explainError = (err: any, fallback: string) => {
  const message = err?.data?.statusMessage || err?.data?.message || err?.statusMessage || err?.message || ''
  if (message === 'reauth_required') return '为了安全，请先点「重新验证身份」重新登录，再完成这个操作。'
  if (message === 'last_method') return '这是唯一的登录方式，不能移除。请先绑定其他方式或设置密码。'
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

const EMAIL_LINK_ERRORS: Record<string, string> = {
  invalid_or_expired_token: '链接无效或已过期，请重新发送。',
  'Email already in use': '这个邮箱已被其他账号使用。',
}

const consumeQueryNotice = async () => {
  const queryText = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
  const linked = queryText('linked')
  const linkError = queryText('link_error')
  const emailVerified = queryText('email_verified')
  const emailChanged = queryText('email_changed')
  const emailError = queryText('email_error')
  if (linked) {
    notice.value = `已绑定 ${providerName(linked)}`
  }
  if (linkError) {
    notice.value = linkError === 'reauth_required' ? explainError({ message: linkError }, '') : `绑定失败：${linkError}`
  }
  if (emailVerified) notice.value = '邮箱已验证'
  if (emailChanged) notice.value = `邮箱已更改为 ${center.value?.profile.email || '新邮箱'}`
  if (emailError) notice.value = `邮箱确认失败：${EMAIL_LINK_ERRORS[emailError] || emailError}`
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
    notice.value = `验证邮件已发送到 ${data?.sent_to || center.value?.profile.email || '你的邮箱'}，请在邮件里点击链接完成验证`
  } catch (err: any) {
    notice.value = isThrottled(err) ? '发送太频繁了，请稍后再试' : explainError(err, '发送验证邮件失败，请稍后再试')
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
    emailChangeError.value = '新邮箱和当前邮箱相同'
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
    notice.value = `已向 ${data?.sent_to || target} 发送确认链接，点击后生效`
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || err?.response?.status || 0)
    if (isReauthError(err)) {
      emailChangeReauth.value = true
    } else if (status === 409) {
      emailChangeError.value = '这个邮箱已被其他账号使用'
    } else if (status === 429) {
      emailChangeError.value = '发送太频繁了，请稍后再试'
    } else {
      emailChangeError.value = explainError(err, '更改邮箱失败，请稍后再试')
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
  const settingFirst = Boolean(methods.value && !methods.value.has_password)
  if ((!settingFirst && !passwordForm.current_password) || !passwordForm.new_password) {
    notice.value = settingFirst ? '请填写新密码' : '请填写当前密码和新密码'
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
    notice.value = settingFirst ? '密码已设置，其他设备会话已撤销' : '密码已更新，其他设备会话已撤销'
    await Promise.all([loadCenter(), loadMethods()])
  } catch (err: any) {
    notice.value = explainError(err, '修改密码失败')
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
  notice.value = failed ? `${done}，但有 ${failed} 个会话撤销失败，请重试` : done
  revokingBulk.value = ''
  await loadCenter()
}

const revokeOtherSessions = async () => {
  if (!process.client || !window.confirm(`退出其他 ${otherActiveSessions.value.length} 个设备上的登录？`)) return
  await revokeSessions('others', otherActiveSessions.value.map((session) => session.id), '已退出其他所有设备')
}

const revokeClientAccess = async (clientId: string, clientName: string) => {
  const sessions = revocableSessionsForClient(clientId)
  if (!process.client || !window.confirm(`撤销 ${clientName} 的访问？该应用在 ${sessions.length} 个设备上的登录都会失效。`)) return
  await revokeSessions(clientId, sessions.map((session) => session.id), `已撤销 ${clientName} 的访问`)
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
      deleteError.value = explainError(err, '暂时无法删除这个账号，请稍后再试')
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
      deleteError.value = explainError(err, '删除失败，请稍后再试')
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
    notice.value = `已解绑 ${row.label}`
    await Promise.all([loadCenter(), loadMethods()])
  } catch (err: any) {
    notice.value = explainError(err, '解绑失败')
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
    notice.value = '数据导出已开始'
  } catch (err: any) {
    notice.value = explainError(err, '导出失败，请稍后再试')
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
</script>

<style scoped>
.merge-block { border: 2px solid var(--color-primary-600); border-radius: 14px; padding: 14px 16px; }
.merge-list { margin: 8px 0 12px; padding-left: 18px; font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); }
.email-field { display: flex; flex-direction: column; gap: 8px; }
.email-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.email-change { display: flex; flex-direction: column; gap: 8px; border: 1px dashed var(--color-border); border-radius: 12px; padding: 12px; }
.danger-block { border: 2px solid var(--color-danger, #c5221f); border-radius: 14px; padding: 14px 16px; }
.merge-refusal { color: var(--color-danger, #c5221f); font-size: 13px; font-weight: 600; margin: 6px 0; }
.reauth-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--color-text-secondary); background: var(--color-primary-50); border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
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
