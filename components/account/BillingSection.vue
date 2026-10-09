<template>
  <div class="section-stack">
    <div class="stack-block">
      <h3>付费与订阅</h3>
      <p class="block-hint">展示账号当前订阅与权益状态。</p>

      <div v-if="center?.billing.subscriptions.length" class="list-wrap">
        <div v-for="sub in center.billing.subscriptions" :key="sub.id" class="list-item">
          <div>
            <strong>{{ sub.plan_name }} ({{ sub.status }})</strong>
            <p>{{ sub.product_name || sub.product_key || 'Unknown product' }} · {{ sub.currency }} {{ priceText(sub.amount_minor) }}</p>
            <small>开始于 {{ formatDateTime(sub.started_at) }} · 周期 {{ sub.billing_cycle }}</small>
          </div>
        </div>
      </div>
      <p v-else class="empty-text">当前无订阅记录</p>

      <div class="entitlement-wrap" v-if="center?.billing.active_entitlement_keys.length">
        <span class="summary-label">活跃权益</span>
        <div class="entitlement-list">
          <span v-for="key in center.billing.active_entitlement_keys" :key="key" class="entitlement-chip">{{ key }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  center,
  formatDateTime,
  priceText,
} = useAccountCenter()
</script>
