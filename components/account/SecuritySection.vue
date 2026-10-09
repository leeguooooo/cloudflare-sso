<template>
  <div class="section-stack">
    <AccountPasskeysBlock v-if="!activePanel" />
    <AccountTwoStepBlock v-if="!activePanel" />
    <AccountSignInAlertsBlock v-if="!activePanel && center?.email_enabled" />
    <div v-if="activePanel !== 'activity'" class="stack-block">
      <h3>{{ tr('设备与会话', 'Devices & sessions') }}</h3>
      <p class="block-hint">{{ tr('可撤销异常设备会话，保护账号安全。', 'Revoke sessions you don’t recognize to keep your account safe.') }}</p>
      <div v-if="otherActiveSessions.length" class="inline-actions">
        <UiButton variant="ghost" size="sm" :loading="revokingBulk === 'others'" @click="revokeOtherSessions">
          {{ tr(`退出其他所有设备（${otherActiveSessions.length}）`, `Sign out all other devices (${otherActiveSessions.length})`) }}
        </UiButton>
      </div>
      <div v-if="center?.sessions.length" class="list-wrap">
        <div v-for="session in center.sessions" :key="session.id" class="list-item">
          <div>
            <strong>{{ session.device_label }}</strong>
            <p>{{ session.client_name || session.client_id || 'Unknown app' }} · {{ session.ip || 'Unknown IP' }}</p>
            <small>{{ formatDateTime(session.created_at) }} · {{ tr(`到期 ${formatDateTime(session.expires_at)}`, `Expires ${formatDateTime(session.expires_at)}`) }}</small>
          </div>
          <div class="list-actions">
            <span v-if="session.is_current" class="tag-current">{{ tr('当前设备', 'This device') }}</span>
            <span v-else-if="session.revoked_at" class="tag-muted">{{ tr('已撤销', 'Revoked') }}</span>
            <UiButton
              v-else
              variant="ghost"
              size="sm"
              :loading="revokingSessionId === session.id"
              @click="revokeSession(session.id)"
            >
              {{ tr('撤销', 'Revoke') }}
            </UiButton>
          </div>
        </div>
      </div>
      <p v-else class="empty-text">{{ tr('暂无设备会话记录', 'No device sessions yet') }}</p>
    </div>

    <div v-if="activePanel !== 'sessions'" class="stack-block">
      <h3>{{ tr('近期活动', 'Recent activity') }}</h3>
      <p class="block-hint">{{ tr('最近账号行为日志（登录、刷新、登出、设置变更）。', 'Recent account events (sign-ins, refreshes, sign-outs, settings changes).') }}</p>
      <div v-if="center?.recent_activity.length" class="list-wrap">
        <div
          v-for="entry in center.recent_activity.slice(0, 12)"
          :key="`${entry.action}-${entry.created_at}`"
          class="list-item"
        >
          <div>
            <strong>{{ entry.action }}</strong>
            <p>{{ entry.ip || 'Unknown IP' }} · {{ simplifyUserAgent(entry.user_agent) }}</p>
            <small>{{ formatDateTime(entry.created_at) }}</small>
          </div>
        </div>
      </div>
      <p v-else class="empty-text">{{ tr('暂无活动记录', 'No activity yet') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  loading,
  center,
  revokingSessionId,
  revokingBulk,
  activePanel,
  revokeSession,
  otherActiveSessions,
  revokeOtherSessions,
  simplifyUserAgent,
  formatDateTime,
} = useAccountCenter()
</script>
