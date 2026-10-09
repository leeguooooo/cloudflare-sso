<template>
  <div class="stack-block">
    <h3>通行密钥</h3>
    <p class="block-hint">用指纹、面容或设备密码登录，不用输入密码，也不需要两步验证码。通行密钥保存在你的设备或密码管理器里，别的网站拿不到。</p>

    <template v-if="reauth">
      <div class="reauth-row">
        <span>为了安全，添加或删除通行密钥前需要你在 15 分钟内登录过。</span>
        <UiButton variant="ghost" size="sm" @click="reauthenticate('/account?section=security')">重新验证身份</UiButton>
      </div>
    </template>

    <p v-if="!supported" class="empty-text">这个浏览器不支持通行密钥。</p>
    <p v-else-if="wrongHost" class="empty-text">请在 {{ rpId }} 上管理通行密钥。</p>

    <div v-if="passkeys.length" class="list-wrap">
      <div v-for="key in passkeys" :key="key.id" class="list-item">
        <div>
          <strong>{{ key.name || '通行密钥' }}</strong>
          <p>{{ key.backed_up ? '已同步到云端（如 iCloud 钥匙串）' : '只保存在这台设备上' }}</p>
          <small>{{ formatDateTime(key.created_at) }} 添加 · {{ key.last_used_at ? `${formatDateTime(key.last_used_at)} 最近使用` : '还没用过' }}</small>
        </div>
        <div class="list-actions">
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="remove(key.id, key.name)">删除</UiButton>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && supported && !wrongHost" class="empty-text">还没有通行密钥。</p>

    <p v-if="errorText" class="merge-refusal">{{ errorText }}</p>
    <div v-if="supported && !wrongHost" class="inline-actions">
      <UiButton variant="primary" size="sm" :loading="busy" @click="add">添加通行密钥</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createPasskey, hostFitsRpId, isPasskeyCancel, passkeysSupported } from '~/utils/webauthn-client'

type Passkey = { id: string; name: string | null; backed_up: boolean; created_at: number; last_used_at: number | null }

const config = useRuntimeConfig()
const { withAuthFetch, reauthenticate, notice, formatDateTime, explainError, isReauthError } = useAccountCenter()

const passkeys = ref<Passkey[]>([])
const rpId = ref('')
const loading = ref(true)
const busy = ref(false)
const reauth = ref(false)
const errorText = ref('')
const supported = ref(false)
const wrongHost = computed(() => Boolean(rpId.value) && process.client && !hostFitsRpId(rpId.value))

const api = <T>(body?: Record<string, unknown>) =>
  withAuthFetch<T>(`${config.public.apiBase}/account/passkeys`, body ? { method: 'POST', body } : {})

const fail = (err: unknown, fallback: string) => {
  if (isReauthError(err)) reauth.value = true
  else if (!isPasskeyCancel(err)) errorText.value = explainError(err, fallback)
}

const load = async () => {
  loading.value = true
  try {
    const data = await api<{ rp_id: string; passkeys: Passkey[] }>()
    rpId.value = data.rp_id
    passkeys.value = data.passkeys
  } catch {
    passkeys.value = []
  } finally {
    loading.value = false
  }
}

/** A readable default name: the platform the passkey was made on. */
const deviceName = () => {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  return '通行密钥'
}

const add = async () => {
  busy.value = true
  errorText.value = ''
  try {
    const options = await api<{ challenge_id: string; publicKey: Parameters<typeof createPasskey>[0] }>({ action: 'register_options' })
    const credential = await createPasskey(options.publicKey)
    const data = await api<{ passkeys: Passkey[] }>({ action: 'register', challenge_id: options.challenge_id, credential, name: deviceName() })
    passkeys.value = data.passkeys
    notice.value = '通行密钥已添加，下次可以直接用它登录'
  } catch (err) {
    fail(err, '添加失败，请稍后再试')
  } finally {
    busy.value = false
  }
}

const remove = async (id: string, name: string | null) => {
  if (!window.confirm(`删除「${name || '通行密钥'}」？删除后它不能再登录这个账号（设备里的那一份可以自己删掉）。`)) return
  busy.value = true
  errorText.value = ''
  try {
    const data = await api<{ passkeys: Passkey[] }>({ action: 'delete', id })
    passkeys.value = data.passkeys
    notice.value = '通行密钥已删除'
  } catch (err) {
    fail(err, '删除失败，请稍后再试')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  supported.value = passkeysSupported()
  void load()
})
</script>
