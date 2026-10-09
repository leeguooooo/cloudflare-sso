<template>
  <div class="form-grid">
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
</template>

<script setup lang="ts">
const {
  loading,
  center,
  savingProfile,
  sendingVerify,
  emailChangeOpen,
  emailChangeReauth,
  newEmail,
  changingEmail,
  emailChangeError,
  profileForm,
  merge,
  reauthenticate,
  sendVerifyEmail,
  openEmailChange,
  closeEmailChange,
  submitEmailChange,
  saveProfile,
} = useAccountCenter()
</script>
