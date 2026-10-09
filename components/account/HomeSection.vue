<template>
  <div class="summary-grid">
    <div class="summary-item">
      <span class="summary-label">Tenant</span>
      <strong>{{ center?.profile.tid || '未关联' }}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">Global Account</span>
      <strong>{{ center?.profile.gaid || '未关联' }}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">Roles</span>
      <strong>{{ roleLabel }}</strong>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  center,
  roleLabel,
} = useAccountCenter()
</script>
