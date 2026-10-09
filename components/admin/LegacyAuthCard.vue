<template>
  <UiCard class="legacy-card">
    <template #header>
      <div class="legacy-header">
        <h3>Legacy sign-in paths · last {{ days }} days</h3>
        <span v-if="error" class="bad">{{ error }}</span>
      </div>
    </template>
    <p class="hint">
      Requests apps still serve through their pre-SSO auth (reported to <code>POST /api/metrics/legacy-auth</code>). A path can
      be removed once it stays under {{ threshold * 100 }}% for {{ cutDays }} days in a row.
    </p>
    <div v-if="paths.length" class="legacy-table">
      <div class="legacy-row legacy-head">
        <span>App</span>
        <span>Path</span>
        <span>Legacy / total</span>
        <span>Rate</span>
        <span>Status</span>
      </div>
      <div v-for="row in paths" :key="`${row.client_id}:${row.path}`" class="legacy-row">
        <span class="mono">{{ row.client_id }}</span>
        <span class="mono">{{ row.path }}</span>
        <span>{{ row.legacy_hits }} / {{ row.total_requests }}</span>
        <span :class="{ bad: row.rate >= threshold }">{{ (row.rate * 100).toFixed(2) }}%</span>
        <span>
          <UiBadge :variant="row.ready_to_cut ? 'success' : 'neutral'" :label="row.ready_to_cut ? 'ready to remove' : 'keep'" />
        </span>
      </div>
    </div>
    <p v-else-if="!loading" class="hint">No app has reported legacy traffic for this tenant.</p>
  </UiCard>
</template>

<script setup lang="ts">
type Row = { client_id: string; path: string; legacy_hits: number; total_requests: number; rate: number; ready_to_cut: boolean }

const props = withDefaults(defineProps<{ tenantId: string; days?: number }>(), { days: 14 })
const { get, errorText } = useAdminApi()
const paths = ref<Row[]>([])
const threshold = ref(0.001)
const cutDays = ref(7)
const loading = ref(false)
const error = ref('')

const load = async () => {
  if (!props.tenantId) return
  loading.value = true
  error.value = ''
  try {
    const data = await get<{ paths: Row[]; threshold: number; cut_days: number }>('/admin/legacy-auth', { tenant_id: props.tenantId, days: props.days })
    paths.value = data.paths || []
    threshold.value = data.threshold
    cutDays.value = data.cut_days
  } catch (err) {
    paths.value = []
    error.value = errorText(err, 'Failed to load legacy usage')
  } finally {
    loading.value = false
  }
}

watch(() => [props.tenantId, props.days], load)
onMounted(load)
</script>

<style scoped>
.legacy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.legacy-header h3 {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0;
  color: #1f1f1f;
}

.hint {
  color: #5f6368;
  font-size: 0.8125rem;
  margin: 0 0 12px;
}

.legacy-table {
  display: flex;
  flex-direction: column;
  font-size: 0.8125rem;
}

.legacy-row {
  display: grid;
  grid-template-columns: 2fr 2fr 1.5fr 1fr 1.5fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f1f3f4;
  align-items: center;
}

.legacy-head {
  color: #5f6368;
  font-weight: 500;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bad {
  color: #d93025;
}
</style>
