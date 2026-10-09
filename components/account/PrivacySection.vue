<template>
  <div class="section-stack">
    <div class="stack-block">
      <h3>{{ tr('数据与隐私', 'Data & privacy') }}</h3>
      <p class="block-hint">{{ tr('下载你的账号信息：资料、登录方式、会话、活动记录、订阅与权益，JSON 格式。各应用里的内容（如剪贴板记录）不包含在内。', 'Download your account data as JSON: profile, sign-in methods, sessions, activity, subscriptions and entitlements. Content inside apps (such as clipboard items) is not included.') }}</p>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">{{ tr('邮箱', 'Email') }}</span>
          <strong>{{ center?.profile.email || tr('未设置', 'Not set') }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">Locale</span>
          <strong>{{ center?.profile.locale || 'en' }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ tr('活跃权益', 'Active entitlements') }}</span>
          <strong>{{ center?.billing.active_entitlement_keys.length || 0 }}</strong>
        </div>
      </div>
      <div class="inline-actions">
        <UiButton variant="primary" :loading="exportingData" @click="downloadExport">{{ tr('下载账号信息 (JSON)', 'Download your data (JSON)') }}</UiButton>
      </div>
    </div>

    <div class="stack-block danger-block">
      <h3>{{ tr('删除账号', 'Delete account') }}</h3>
      <p class="block-hint">
        {{ tr('永久删除这个 leeguoo 账号：所有登录方式、会话和各应用中的账号都会被删除，所有设备都会退出登录。此操作无法撤销。', 'Permanently delete this leeguoo account: all sign-in methods, sessions and app accounts are deleted, and every device is signed out. This can’t be undone.') }}
      </p>
      <template v-if="deleteStep === 'idle'">
        <div class="inline-actions">
          <UiButton variant="ghost" :loading="deleteChecking" @click="startDeleteAccount">{{ tr('删除账号…', 'Delete account…') }}</UiButton>
        </div>
      </template>
      <template v-else-if="deleteStep === 'blocked'">
        <p class="merge-refusal">{{ deleteError }}</p>
        <div class="inline-actions">
          <UiButton variant="ghost" size="sm" @click="resetDeleteAccount">{{ tr('好的', 'OK') }}</UiButton>
        </div>
      </template>
      <template v-else-if="deleteStep === 'reauth'">
        <p class="merge-refusal">{{ tr('为了安全，删除账号前需要你重新登录一次。', 'For your security, sign in again before deleting your account.') }}</p>
        <div class="inline-actions">
          <UiButton variant="primary" size="sm" @click="reauthenticate('/account?section=privacy')">{{ tr('重新登录', 'Sign in again') }}</UiButton>
          <UiButton variant="ghost" size="sm" @click="resetDeleteAccount">{{ tr('取消', 'Cancel') }}</UiButton>
        </div>
      </template>
      <template v-else>
        <UiInput
          v-model="deleteConfirmText"
          :label="tr(`请输入 ${deleteConfirmTarget} 以确认删除`, `Type ${deleteConfirmTarget} to confirm`)"
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
            {{ tr('永久删除账号', 'Delete account permanently') }}
          </UiButton>
          <UiButton variant="ghost" :disabled="deletingAccount" @click="resetDeleteAccount">{{ tr('取消', 'Cancel') }}</UiButton>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  loading,
  center,
  exportingData,
  deleteStep,
  deleteChecking,
  deletingAccount,
  deleteConfirmText,
  deleteError,
  merge,
  reauthenticate,
  deleteConfirmTarget,
  deleteConfirmMatches,
  resetDeleteAccount,
  startDeleteAccount,
  confirmDeleteAccount,
  downloadExport,
} = useAccountCenter()
</script>
