<template>
  <div class="summary-grid">
    <div class="summary-item">
      <span class="summary-label">Tenant</span>
      <strong>{{ center?.profile.tid || tr('未关联', 'Not linked') }}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">Global Account</span>
      <strong>{{ center?.profile.gaid || tr('未关联', 'Not linked') }}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">Roles</span>
      <strong>{{ roleLabel }}</strong>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  center,
  roleLabel,
} = useAccountCenter()
</script>
