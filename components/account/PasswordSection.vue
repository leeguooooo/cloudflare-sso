<template>
  <div class="form-grid">
    <p v-if="methods && !methods.has_password" class="block-hint">
      {{ tr(`这个账号是通过第三方登录创建的，还没有密码。设置后可以用 ${methods.email} 和密码登录。`, `This account was created with a third-party sign-in and has no password yet. Set one to sign in with ${methods.email} and a password.`) }}
    </p>
    <UiInput
      v-if="!methods || methods.has_password"
      v-model="passwordForm.current_password"
      type="password"
      :label="tr('当前密码', 'Current password')"
      autocomplete="current-password"
      :disabled="changingPassword"
    />
    <UiInput
      v-model="passwordForm.new_password"
      type="password"
      :label="tr('新密码', 'New password')"
      autocomplete="new-password"
      :disabled="changingPassword"
    />
    <UiInput
      v-model="passwordForm.confirm_password"
      type="password"
      :label="tr('确认新密码', 'Confirm new password')"
      autocomplete="new-password"
      :disabled="changingPassword"
    />
    <p class="block-hint">{{ tr('密码长度至少 8 位，修改后会自动撤销其他设备会话。', 'Use at least 8 characters. Changing it signs you out on other devices.') }}</p>
    <div class="inline-actions">
      <UiButton variant="primary" :loading="changingPassword" @click="changePassword">{{ methods && !methods.has_password ? tr('设置密码', 'Set password') : tr('更新密码', 'Update password') }}</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  loading,
  changingPassword,
  passwordForm,
  methods,
  changePassword,
} = useAccountCenter()
</script>
