<template>
  <div class="stack-block">
    <h3>{{ tr('通行密钥', 'Passkeys') }}</h3>
    <p class="block-hint">{{ tr('用指纹、面容或设备密码登录，不用输入密码，也不需要两步验证码。通行密钥保存在你的设备或密码管理器里，别的网站拿不到。', 'Sign in with your fingerprint, face or device PIN — no password and no verification code. Passkeys live on your device or in your password manager, and other sites can’t use them.') }}</p>

    <template v-if="reauth">
      <div class="reauth-row">
        <span>{{ tr('为了安全，添加或删除通行密钥前需要你在 15 分钟内登录过。', 'For your security, you need to have signed in within the last 15 minutes to add or remove passkeys.') }}</span>
        <UiButton variant="ghost" size="sm" @click="reauthenticate('/account?section=security')">{{ tr('重新验证身份', 'Verify it’s you') }}</UiButton>
      </div>
    </template>

    <p v-if="!supported" class="empty-text">{{ tr('这个浏览器不支持通行密钥。', 'This browser doesn’t support passkeys.') }}</p>
    <p v-else-if="wrongHost" class="empty-text">{{ tr(`请在 ${rpId} 上管理通行密钥。`, `Manage passkeys on ${rpId}.`) }}</p>

    <div v-if="passkeys.length" class="list-wrap">
      <div v-for="key in passkeys" :key="key.id" class="list-item">
        <div>
          <strong>{{ key.name || tr('通行密钥', 'Passkey') }}</strong>
          <p>{{ key.backed_up ? tr('已同步到云端（如 iCloud 钥匙串）', 'Synced to the cloud (e.g. iCloud Keychain)') : tr('只保存在这台设备上', 'Only on this device') }}</p>
          <small>{{ tr(`${formatDateTime(key.created_at)} 添加`, `Added ${formatDateTime(key.created_at)}`) }} · {{ key.last_used_at ? tr(`${formatDateTime(key.last_used_at)} 最近使用`, `Last used ${formatDateTime(key.last_used_at)}`) : tr('还没用过', 'Never used') }}</small>
        </div>
        <div class="list-actions">
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="remove(key.id, key.name)">{{ tr('删除', 'Remove') }}</UiButton>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && supported && !wrongHost" class="empty-text">{{ tr('还没有通行密钥。', 'No passkeys yet.') }}</p>

    <p v-if="errorText" class="merge-refusal">{{ errorText }}</p>
    <div v-if="supported && !wrongHost" class="inline-actions">
      <UiButton variant="primary" size="sm" :loading="busy" @click="add">{{ tr('添加通行密钥', 'Add a passkey') }}</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createPasskey, hostFitsRpId, isPasskeyCancel, passkeysSupported } from '~/utils/webauthn-client'

type Passkey = { id: string; name: string | null; backed_up: boolean; created_at: number; last_used_at: number | null }

const config = useRuntimeConfig()
const { tr, withAuthFetch, reauthenticate, notice, formatDateTime, explainError, isReauthError } = useAccountCenter()

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
  return tr('通行密钥', 'Passkey')
}

const add = async () => {
  busy.value = true
  errorText.value = ''
  try {
    const options = await api<{ challenge_id: string; publicKey: Parameters<typeof createPasskey>[0] }>({ action: 'register_options' })
    const credential = await createPasskey(options.publicKey)
    const data = await api<{ passkeys: Passkey[] }>({ action: 'register', challenge_id: options.challenge_id, credential, name: deviceName() })
    passkeys.value = data.passkeys
    notice.value = tr('通行密钥已添加，下次可以直接用它登录', 'Passkey added. You can sign in with it next time.')
  } catch (err) {
    fail(err, tr('添加失败，请稍后再试', 'Couldn’t add the passkey. Try again later.'))
  } finally {
    busy.value = false
  }
}

const remove = async (id: string, name: string | null) => {
  const label = name || tr('通行密钥', 'Passkey')
  if (!window.confirm(tr(`删除「${label}」？删除后它不能再登录这个账号（设备里的那一份可以自己删掉）。`, `Remove “${label}”? It will no longer sign in to this account. (You can delete the copy on your device yourself.)`))) return
  busy.value = true
  errorText.value = ''
  try {
    const data = await api<{ passkeys: Passkey[] }>({ action: 'delete', id })
    passkeys.value = data.passkeys
    notice.value = tr('通行密钥已删除', 'Passkey removed')
  } catch (err) {
    fail(err, tr('删除失败，请稍后再试', 'Couldn’t remove the passkey. Try again later.'))
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  supported.value = passkeysSupported()
  void load()
})
</script>
