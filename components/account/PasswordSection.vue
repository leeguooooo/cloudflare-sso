<template>
  <div class="form-grid">
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
</template>

<script setup lang="ts">
const {
  loading,
  changingPassword,
  passwordForm,
  methods,
  changePassword,
} = useAccountCenter()
</script>
