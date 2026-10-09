<template>
  <div class="section-stack">
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
</template>

<script setup lang="ts">
const {
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
