<template>
  <div class="section-stack">
    <div class="stack-block">
      <h3>{{ tr('付费与订阅', 'Payments & subscriptions') }}</h3>
      <p class="block-hint">{{ tr('展示账号当前订阅与权益状态。', 'Your current subscriptions and entitlements.') }}</p>

      <div v-if="center?.billing.subscriptions.length" class="list-wrap">
        <div v-for="sub in center.billing.subscriptions" :key="sub.id" class="list-item">
          <div>
            <strong>{{ sub.plan_name }} ({{ sub.status }})</strong>
            <p>{{ sub.product_name || sub.product_key || 'Unknown product' }} · {{ sub.currency }} {{ priceText(sub.amount_minor) }}</p>
            <small>{{ tr(`开始于 ${formatDateTime(sub.started_at)} · 周期 ${sub.billing_cycle}`, `Started ${formatDateTime(sub.started_at)} · Cycle ${sub.billing_cycle}`) }}</small>
          </div>
        </div>
      </div>
      <p v-else class="empty-text">{{ tr('当前无订阅记录', 'No subscriptions') }}</p>

      <div class="entitlement-wrap" v-if="center?.billing.active_entitlement_keys.length">
        <span class="summary-label">{{ tr('活跃权益', 'Active entitlements') }}</span>
        <div class="entitlement-list">
          <span v-for="key in center.billing.active_entitlement_keys" :key="key" class="entitlement-chip">{{ key }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  center,
  formatDateTime,
  priceText,
} = useAccountCenter()
</script>
