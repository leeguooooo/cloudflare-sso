<template>
  <div class="stack-block">
    <h3>两步验证</h3>
    <p class="block-hint">用邮箱和密码登录时，还要输入身份验证器 App（如 Google Authenticator、1Password、Authy）里的 6 位验证码。第三方登录（Apple、Google、GitHub）不受影响。</p>

    <p v-if="loadingStatus" class="empty-text">正在读取…</p>

    <template v-else-if="reauth">
      <div class="reauth-row">
        <span>为了安全，更改两步验证前需要你在 15 分钟内登录过。</span>
        <UiButton variant="ghost" size="sm" @click="reauthenticate('/account?section=security')">重新验证身份</UiButton>
      </div>
    </template>

    <!-- recovery codes, shown once right after they are created -->
    <template v-else-if="recoveryCodes.length">
      <p class="merge-refusal">请把这些备用码保存在安全的地方。手机丢了时，每个备用码可以代替验证码登录一次。离开这个页面后就看不到了。</p>
      <ul class="recovery-grid">
        <li v-for="code in recoveryCodes" :key="code">{{ code }}</li>
      </ul>
      <div class="inline-actions">
        <UiButton variant="ghost" size="sm" @click="downloadCodes">下载 .txt</UiButton>
        <UiButton variant="ghost" size="sm" @click="copyCodes">{{ copied ? '已复制' : '复制' }}</UiButton>
        <UiButton variant="primary" size="sm" @click="recoveryCodes = []">我已保存</UiButton>
      </div>
    </template>

    <!-- enrolment: scan, then confirm one code -->
    <template v-else-if="setup">
      <div class="setup">
        <div class="qr" v-html="qrSvg" />
        <div class="setup-text">
          <p class="block-hint">1. 用身份验证器 App 扫描二维码。在手机上可以直接<a :href="setup.otpauth_uri">在 App 中打开</a>，或者手动输入密钥：</p>
          <code class="secret">{{ groupedSecret }}</code>
          <p class="block-hint">2. 输入 App 显示的 6 位验证码。</p>
          <UiInput v-model="code" label="验证码" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" :disabled="busy" />
          <p v-if="errorText" class="merge-refusal">{{ errorText }}</p>
          <div class="inline-actions">
            <UiButton variant="primary" size="sm" :loading="busy" :disabled="!code.trim()" @click="confirm">开启</UiButton>
            <UiButton variant="ghost" size="sm" :disabled="busy" @click="cancelSetup">取消</UiButton>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="status?.enabled">
      <div class="list-wrap">
        <div class="list-item">
          <div>
            <strong>身份验证器</strong>
            <p>{{ formatDateTime(status.enabled_at) }} 开启</p>
            <small>剩余备用码 {{ status.recovery_codes_remaining }} 个</small>
          </div>
          <div class="list-actions">
            <span class="tag-current">已开启</span>
          </div>
        </div>
      </div>
      <p v-if="status.recovery_codes_remaining <= 2" class="merge-refusal">备用码快用完了，建议重新生成一组。</p>
      <UiInput v-model="code" label="当前验证码或备用码（更改设置时需要）" autocomplete="one-time-code" :disabled="busy" />
      <p v-if="errorText" class="merge-refusal">{{ errorText }}</p>
      <div class="inline-actions">
        <UiButton variant="ghost" size="sm" :loading="busy && pending === 'regenerate_recovery_codes'" :disabled="busy || !code.trim()" @click="manage('regenerate_recovery_codes')">
          重新生成备用码
        </UiButton>
        <UiButton variant="ghost" size="sm" class="danger-text" :loading="busy && pending === 'disable'" :disabled="busy || !code.trim()" @click="manage('disable')">
          关闭两步验证
        </UiButton>
      </div>
    </template>

    <template v-else>
      <p v-if="methods && !methods.has_password" class="block-hint">这个账号还没有密码。两步验证保护的是邮箱密码登录，请先在「leeguoo 密码」里设置密码。</p>
      <p v-if="errorText" class="merge-refusal">{{ errorText }}</p>
      <div class="inline-actions">
        <UiButton variant="primary" size="sm" :loading="busy" :disabled="Boolean(methods && !methods.has_password)" @click="start">开启两步验证</UiButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { renderSVG } from 'uqr'

type MfaStatus = { enabled: boolean; enabled_at: number | null; recovery_codes_remaining: number }
type ManageAction = 'regenerate_recovery_codes' | 'disable'

const config = useRuntimeConfig()
const { withAuthFetch, reauthenticate, methods, notice, formatDateTime, explainError, isReauthError } = useAccountCenter()

const status = ref<MfaStatus | null>(null)
const loadingStatus = ref(true)
const setup = ref<{ secret: string; otpauth_uri: string } | null>(null)
const recoveryCodes = ref<string[]>([])
const code = ref('')
const busy = ref(false)
const pending = ref<ManageAction | ''>('')
const reauth = ref(false)
const errorText = ref('')
const copied = ref(false)

const ERRORS: Record<string, string> = {
  invalid_code: '验证码不对。请输入 App 里当前显示的验证码。',
  mfa_setup_expired: '设置超时了，请重新开始。',
  mfa_already_enabled: '两步验证已经开启。',
  password_required: '请先设置密码。',
}

const qrSvg = computed(() => (setup.value ? renderSVG(setup.value.otpauth_uri, { border: 1 }) : ''))
const groupedSecret = computed(() => (setup.value?.secret || '').replace(/(.{4})/g, '$1 ').trim())

const api = <T>(body?: Record<string, unknown>) =>
  withAuthFetch<T>(`${config.public.apiBase}/account/mfa`, body ? { method: 'POST', body } : {})

const handleError = (err: unknown, fallback: string) => {
  if (isReauthError(err)) {
    reauth.value = true
    return
  }
  const reason = (err as { data?: { message?: string; statusMessage?: string } })?.data
  const key = reason?.message || reason?.statusMessage || ''
  errorText.value = ERRORS[key] || explainError(err, fallback)
  if (key === 'mfa_setup_expired') setup.value = null
}

const loadStatus = async () => {
  loadingStatus.value = true
  try {
    status.value = await api<MfaStatus>()
  } catch {
    status.value = null
  } finally {
    loadingStatus.value = false
  }
}

const start = async () => {
  busy.value = true
  errorText.value = ''
  try {
    setup.value = await api<{ secret: string; otpauth_uri: string }>({ action: 'start' })
    code.value = ''
  } catch (err) {
    handleError(err, '暂时无法开启，请稍后再试')
  } finally {
    busy.value = false
  }
}

const cancelSetup = () => {
  setup.value = null
  code.value = ''
  errorText.value = ''
}

const confirm = async () => {
  busy.value = true
  errorText.value = ''
  try {
    const data = await api<{ recovery_codes: string[]; status: MfaStatus }>({ action: 'confirm', code: code.value.trim() })
    recoveryCodes.value = data.recovery_codes
    status.value = data.status
    setup.value = null
    code.value = ''
    notice.value = '两步验证已开启'
  } catch (err) {
    handleError(err, '开启失败，请稍后再试')
  } finally {
    busy.value = false
  }
}

const manage = async (action: ManageAction) => {
  if (action === 'disable' && process.client && !window.confirm('关闭两步验证？之后只用密码就能登录。')) return
  busy.value = true
  pending.value = action
  errorText.value = ''
  try {
    const data = await api<{ recovery_codes?: string[]; status: MfaStatus }>({ action, code: code.value.trim() })
    status.value = data.status
    recoveryCodes.value = data.recovery_codes || []
    code.value = ''
    notice.value = action === 'disable' ? '两步验证已关闭' : '已生成新的备用码，旧的备用码全部失效'
  } catch (err) {
    handleError(err, '操作失败，请稍后再试')
  } finally {
    busy.value = false
    pending.value = ''
  }
}

const codesText = () => `leeguoo 账号备用码（每个只能用一次）\n\n${recoveryCodes.value.join('\n')}\n`

const downloadCodes = () => {
  if (!process.client) return
  const url = URL.createObjectURL(new Blob([codesText()], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'leeguoo-recovery-codes.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const copyCodes = async () => {
  try {
    await navigator.clipboard.writeText(codesText())
    copied.value = true
  } catch {
    copied.value = false
  }
}

onMounted(loadStatus)
</script>

<style scoped>
.setup {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.qr {
  width: 168px;
  height: 168px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 12px;
  padding: 6px;
}

.qr :deep(svg) {
  width: 100%;
  height: 100%;
}

.setup-text {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.secret {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 15px;
  letter-spacing: 1px;
  word-break: break-all;
}

.recovery-grid {
  list-style: none;
  padding: 0;
  margin: 8px 0 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 15px;
}

.danger-text {
  color: var(--color-danger, #c5221f);
}
</style>
