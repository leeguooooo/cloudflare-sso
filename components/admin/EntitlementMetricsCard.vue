<template>
  <UiCard class="ent-card">
    <template #header>
      <div class="ent-header">
        <h3>Entitlement checks · last {{ days }} days</h3>
        <span v-if="error" class="ent-error">{{ error }}</span>
      </div>
    </template>

    <p class="ent-hint">
      Answers apps got from <code>GET /api/billing/entitlements/check</code>. A jump in denials usually means a billing sync
      or a renamed key broke paid access.
    </p>

    <div v-if="totals.length" class="ent-table">
      <div class="ent-row ent-head">
        <span>App</span>
        <span>Entitlement</span>
        <span>Allowed</span>
        <span>Denied</span>
        <span>Deny rate</span>
      </div>
      <div v-for="row in totals" :key="`${row.client_id}:${row.entitlement_key}`" class="ent-row">
        <span class="mono">{{ row.client_id }}</span>
        <span class="mono">{{ row.entitlement_key }}</span>
        <span>{{ row.allowed }}</span>
        <span>{{ row.denied }}</span>
        <span :class="{ bad: row.deny_rate >= 0.5 && row.total >= 10 }">{{ Math.round(row.deny_rate * 100) }}%</span>
      </div>
    </div>
    <p v-else-if="!loading" class="ent-empty">No entitlement checks recorded in this window.</p>
  </UiCard>
</template>

<script setup lang="ts">
type Row = { client_id: string; entitlement_key: string; allowed: number; denied: number; total: number; deny_rate: number }

const props = withDefaults(defineProps<{ tenantId: string; days?: number }>(), { days: 7 })
const { get, errorText } = useAdminApi()
const totals = ref<Row[]>([])
const loading = ref(false)
const error = ref('')

const load = async () => {
  if (!props.tenantId) return
  loading.value = true
  error.value = ''
  try {
    const data = await get<{ totals: Row[] }>('/admin/entitlement-metrics', { tenant_id: props.tenantId, days: props.days })
    totals.value = data.totals || []
  } catch (err) {
    totals.value = []
    error.value = errorText(err, 'Failed to load entitlement metrics')
  } finally {
    loading.value = false
  }
}

watch(() => [props.tenantId, props.days], load)
onMounted(load)
</script>

<style scoped>
.ent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.ent-header h3 {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0;
  color: #1f1f1f;
}

.ent-error,
.bad {
  color: #d93025;
}

.ent-hint,
.ent-empty {
  color: #5f6368;
  font-size: 0.8125rem;
  margin: 0 0 12px;
}

.ent-table {
  display: flex;
  flex-direction: column;
  font-size: 0.8125rem;
}

.ent-row {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 1fr 1fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f1f3f4;
}

.ent-head {
  color: #5f6368;
  font-weight: 500;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
