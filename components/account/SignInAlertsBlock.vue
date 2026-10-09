<template>
  <div class="stack-block">
    <h3>登录提醒</h3>
    <p class="block-hint">账号在一台新设备或新浏览器上登录时，给 {{ center?.profile.email || '你的邮箱' }} 发一封邮件。180 天内用过的设备不提醒。</p>
    <UiCheckbox :model-value="enabled" :disabled="loading || saving" label="新设备登录时发邮件提醒我" @update:model-value="save" />
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig()
const { withAuthFetch, center, notice, explainError } = useAccountCenter()
const enabled = ref(true)
const loading = ref(true)
const saving = ref(false)

const save = async (value: boolean) => {
  saving.value = true
  const previous = enabled.value
  enabled.value = value
  try {
    const data = await withAuthFetch<{ sign_in_alerts: boolean }>(`${config.public.apiBase}/account/preferences`, {
      method: 'PATCH',
      body: { sign_in_alerts: value },
    })
    enabled.value = data.sign_in_alerts
    notice.value = value ? '已开启登录提醒' : '已关闭登录提醒'
  } catch (err) {
    enabled.value = previous
    notice.value = explainError(err, '保存失败，请稍后再试')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    enabled.value = (await withAuthFetch<{ sign_in_alerts: boolean }>(`${config.public.apiBase}/account/preferences`)).sign_in_alerts
  } catch {
    enabled.value = true
  } finally {
    loading.value = false
  }
})
</script>
