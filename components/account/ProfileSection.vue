<template>
  <div class="form-grid">
    <UiInput
      v-model="profileForm.display_name"
      :label="tr('显示名称', 'Display name')"
      :placeholder="tr('输入显示名称', 'Enter a display name')"
      :disabled="savingProfile"
    />
    <div class="email-field">
      <UiInput
        :model-value="center?.profile.email || ''"
        :label="tr('邮箱', 'Email')"
        disabled
      />
      <div class="email-meta">
        <UiBadge
          :variant="center?.profile.email_verified ? 'success' : 'neutral'"
          :label="center?.profile.email_verified ? tr('已验证', 'Verified') : tr('未验证', 'Unverified')"
        />
        <UiButton
          v-if="center?.email_enabled && !center?.profile.email_verified"
          variant="ghost"
          size="sm"
          :loading="sendingVerify"
          @click="sendVerifyEmail"
        >
          {{ tr('发送验证邮件', 'Send verification email') }}
        </UiButton>
        <UiButton
          v-if="center?.email_enabled && !emailChangeOpen"
          variant="ghost"
          size="sm"
          @click="openEmailChange"
        >
          {{ tr('更改邮箱', 'Change email') }}
        </UiButton>
      </div>
      <div v-if="emailChangeOpen" class="email-change">
        <UiInput
          v-model="newEmail"
          :label="tr('新邮箱', 'New email')"
          type="email"
          placeholder="you@example.com"
          autocomplete="email"
          :disabled="changingEmail"
        />
        <p class="block-hint">{{ tr('我们会向新邮箱发送确认链接，点击后才会生效；在此之前仍使用当前邮箱登录。', 'We’ll send a confirmation link to the new email. The change takes effect once you click it; until then, keep signing in with your current email.') }}</p>
        <template v-if="emailChangeReauth">
          <p class="merge-refusal">{{ tr('为了安全，更改邮箱前需要你重新登录一次。', 'For your security, sign in again before changing your email.') }}</p>
          <div class="inline-actions">
            <UiButton variant="primary" size="sm" @click="reauthenticate('/account?section=profile')">{{ tr('重新登录', 'Sign in again') }}</UiButton>
            <UiButton variant="ghost" size="sm" @click="closeEmailChange">{{ tr('取消', 'Cancel') }}</UiButton>
          </div>
        </template>
        <template v-else>
          <p v-if="emailChangeError" class="merge-refusal">{{ emailChangeError }}</p>
          <div class="inline-actions">
            <UiButton variant="primary" size="sm" :loading="changingEmail" :disabled="!newEmail.trim()" @click="submitEmailChange">{{ tr('发送确认链接', 'Send confirmation link') }}</UiButton>
            <UiButton variant="ghost" size="sm" :disabled="changingEmail" @click="closeEmailChange">{{ tr('取消', 'Cancel') }}</UiButton>
          </div>
        </template>
      </div>
    </div>
    <UiInput
      v-model="profileForm.locale"
      label="Locale"
      :placeholder="tr('例如 en / zh-CN', 'e.g. en / zh-CN')"
      :disabled="savingProfile"
    />
    <UiInput
      :model-value="center?.profile.tid || ''"
      :label="tr('租户', 'Tenant')"
      disabled
    />
    <div class="inline-actions">
      <UiButton variant="primary" :loading="savingProfile" @click="saveProfile">{{ tr('保存个人信息', 'Save') }}</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
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
