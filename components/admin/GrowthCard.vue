<template>
  <UiCard class="growth-card">
    <template #header>
      <div class="growth-header">
        <h3>Users · last {{ days }} days</h3>
        <span v-if="error" class="bad">{{ error }}</span>
      </div>
    </template>
    <div class="tiles">
      <div v-for="tile in tiles" :key="tile.label" class="tile">
        <span class="label">{{ tile.label }}</span>
        <span class="value">{{ tile.value }}</span>
      </div>
    </div>
    <div v-if="daily.length" class="chart" role="img" :aria-label="`Active and new users per day, last ${days} days`">
      <div v-for="day in daily" :key="day.day" class="col" :title="`${day.day}: ${day.active_users} active, ${day.new_users} new`">
        <span class="bar active" :style="{ height: pct(day.active_users) }" />
        <span class="bar new" :style="{ height: pct(day.new_users) }" />
      </div>
    </div>
    <div class="legend"><span class="dot active" /> active <span class="dot new" /> new</div>
  </UiCard>
</template>

<script setup lang="ts">
type Day = { day: string; new_users: number; active_users: number }

const props = withDefaults(defineProps<{ tenantId: string; days?: number }>(), { days: 30 })
const { get, errorText } = useAdminApi()
const total = ref(0)
const active = ref({ dau: 0, wau: 0, mau: 0 })
const daily = ref<Day[]>([])
const error = ref('')

const tiles = computed(() => [
  { label: 'Total users', value: total.value },
  { label: 'Active today', value: active.value.dau },
  { label: 'Active 7 days', value: active.value.wau },
  { label: 'Active 30 days', value: active.value.mau },
])
const max = computed(() => Math.max(1, ...daily.value.map((d) => Math.max(d.active_users, d.new_users))))
const pct = (value: number) => `${Math.round((value / max.value) * 100)}%`

const load = async () => {
  if (!props.tenantId) return
  error.value = ''
  try {
    const data = await get<{ total_users: number; active: { dau: number; wau: number; mau: number }; daily: Day[] }>('/admin/growth', { tenant_id: props.tenantId, days: props.days })
    total.value = data.total_users
    active.value = data.active
    daily.value = data.daily
  } catch (err) {
    error.value = errorText(err, 'Failed to load user growth')
  }
}

watch(() => [props.tenantId, props.days], load)
onMounted(load)
</script>

<style scoped>
.growth-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.growth-header h3 {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0;
  color: #1f1f1f;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid #e8eaed;
  border-radius: 12px;
}

.label {
  font-size: 0.75rem;
  color: #5f6368;
  text-transform: uppercase;
}

.value {
  font-size: 1.5rem;
  color: #1a73e8;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
  padding-bottom: 4px;
  border-bottom: 1px solid #e8eaed;
}

.col {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 1px;
}

.bar {
  flex: 1;
  min-height: 1px;
  border-radius: 2px 2px 0 0;
}

.bar.active,
.dot.active {
  background: #1a73e8;
}

.bar.new,
.dot.new {
  background: #34a853;
}

.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.75rem;
  color: #5f6368;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-left: 8px;
}

.bad {
  color: #d93025;
}
</style>
