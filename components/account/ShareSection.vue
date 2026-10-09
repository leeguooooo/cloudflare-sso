<template>
  <div class="section-stack">
    <div class="stack-block">
      <h3>用户与分享</h3>
      <p class="block-hint">当前账号在各应用中的会话与访问范围。</p>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">角色</span>
          <strong>{{ roleLabel }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">应用数</span>
          <strong>{{ center?.sharing.clients.length || 0 }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">权限数</span>
          <strong>{{ center?.profile.perms.length || 0 }}</strong>
        </div>
      </div>

      <div v-if="center?.sharing.clients.length" class="list-wrap">
        <div v-for="client in center.sharing.clients" :key="client.client_id" class="list-item">
          <div>
            <strong>{{ client.client_name }}</strong>
            <p>{{ client.client_id }}</p>
            <small>最近访问 {{ formatDateTime(client.last_seen_at) }}</small>
          </div>
          <div class="list-actions">
            <span class="tag-muted">活动会话 {{ client.active_sessions }}</span>
            <UiButton
              v-if="revocableSessionsForClient(client.client_id).length"
              variant="ghost"
              size="sm"
              :loading="revokingBulk === client.client_id"
              @click="revokeClientAccess(client.client_id, client.client_name)"
            >
              撤销访问
            </UiButton>
          </div>
        </div>
      </div>
      <p v-else class="empty-text">暂无跨应用会话记录</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  loading,
  center,
  revokingBulk,
  roleLabel,
  revocableSessionsForClient,
  revokeClientAccess,
  formatDateTime,
} = useAccountCenter()
</script>
