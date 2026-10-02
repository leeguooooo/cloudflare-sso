<template>
  <div class="admin-home">
    <div class="admin-header">
      <div class="header-content">
        <h2 class="section-title">Overview</h2>
        <div class="tenant-selector">
          <UiInput v-model="tenantId" label="Tenant ID" class="tenant-input" />
          <UiButton variant="ghost" @click="refresh" :loading="loading">
            Refresh
          </UiButton>
        </div>
      </div>
    </div>

    <div class="stats-container">
      <UiCard v-for="item in stats" :key="item.label" class="stat-card">
        <div class="stat-info">
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-value">{{ item.value }}</span>
        </div>
        <template #footer>
          <NuxtLink v-if="item.link" :to="item.link" class="stat-link">View details</NuxtLink>
        </template>
      </UiCard>
    </div>

    <UiCard class="metrics-card">
      <template #header>
        <div class="metrics-header">
          <h3>Sign-in activity · last {{ metrics.days }} days</h3>
          <span v-if="metricsError" class="metrics-error">{{ metricsError }}</span>
        </div>
      </template>

      <div class="metric-tiles">
        <div v-for="tile in metricTiles" :key="tile.key" class="metric-tile">
          <span class="stat-label">{{ tile.label }}</span>
          <span class="metric-value" :class="{ 'metric-bad': tile.key === 'login_failure' && tile.value > 0 }">{{ tile.value }}</span>
        </div>
      </div>

      <div v-if="metrics.daily.length" class="daily-table">
        <div class="daily-row daily-head">
          <span>Day</span>
          <span>Sign-ins</span>
          <span>Failed</span>
          <span>Tokens</span>
          <span>Refreshes</span>
        </div>
        <div v-for="day in metrics.daily" :key="day.day" class="daily-row">
          <span class="day-label">{{ day.day }}</span>
          <span class="bar-cell"><span class="bar bar-ok" :style="barStyle(day.login_success)" />{{ day.login_success }}</span>
          <span class="bar-cell"><span class="bar bar-bad" :style="barStyle(day.login_failure)" />{{ day.login_failure }}</span>
          <span class="bar-cell"><span class="bar" :style="barStyle(day.token_issued)" />{{ day.token_issued }}</span>
          <span class="bar-cell"><span class="bar" :style="barStyle(day.refresh)" />{{ day.refresh }}</span>
        </div>
      </div>
      <p v-else class="metrics-empty">No sign-in activity recorded in this window.</p>

      <div v-if="metrics.by_client.length" class="client-list">
        <h4>By application</h4>
        <div v-for="client in metrics.by_client" :key="client.client_id" class="client-row">
          <span class="client-id">{{ client.client_id }}</span>
          <span>{{ client.token_issued }} tokens</span>
          <span>{{ client.refresh }} refreshes</span>
        </div>
      </div>
    </UiCard>

    <div class="management-grid">
      <UiCard class="management-card">
        <div class="card-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <h3>Users & Access</h3>
        </div>
        <p class="card-desc">Manage your users, roles, and application-specific permissions from a central location.</p>
        <NuxtLink to="/admin/access" class="card-action">Manage Access Control</NuxtLink>
      </UiCard>

      <UiCard class="management-card">
        <div class="card-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <h3>Applications</h3>
        </div>
        <p class="card-desc">Configure OIDC clients, redirect URIs, and identity federation settings for your apps.</p>
        <NuxtLink to="/admin/apps" class="card-action">Manage Applications</NuxtLink>
      </UiCard>

      <UiCard class="management-card">
        <div class="card-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <h3>Billing & Subscriptions</h3>
        </div>
        <p class="card-desc">Monitor usage, manage product plans, and handle entitlement transitions for your tenants.</p>
        <NuxtLink to="/admin/billing" class="card-action">Manage Billing</NuxtLink>
      </UiCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storedTokenTenantId } from '~/utils/token-claims'
type OverviewResponse = {
  tenant_id: string
  users: number
  clients: number
  roles: number
  active_sessions: number
}

const config = useRuntimeConfig()
const tenantId = ref('')
const loading = ref(false)
const overview = ref<OverviewResponse>({
  tenant_id: '',
  users: 0,
  clients: 0,
  roles: 0,
  active_sessions: 0,
})

const stats = computed(() => [
  { label: 'Active Users', value: overview.value.users, link: '/admin/users' },
  { label: 'OIDC Clients', value: overview.value.clients, link: '/admin/apps' },
  { label: 'Custom Roles', value: overview.value.roles, link: '/admin/access' },
  { label: 'Active Sessions', value: overview.value.active_sessions, link: '' },
])

type MetricsResponse = {
  days: number
  totals: { login_success: number; login_failure: number; token_issued: number; refresh: number; logout: number; revoked: number }
  daily: Array<{ day: string; login_success: number; login_failure: number; token_issued: number; refresh: number }>
  by_client: Array<{ client_id: string; token_issued: number; refresh: number }>
}

const metricsError = ref('')
const metrics = ref<MetricsResponse>({
  days: 7,
  totals: { login_success: 0, login_failure: 0, token_issued: 0, refresh: 0, logout: 0, revoked: 0 },
  daily: [],
  by_client: [],
})

const metricTiles = computed(() => [
  { key: 'login_success', label: 'Sign-ins', value: metrics.value.totals.login_success },
  { key: 'login_failure', label: 'Failed sign-ins', value: metrics.value.totals.login_failure },
  { key: 'token_issued', label: 'Tokens issued', value: metrics.value.totals.token_issued },
  { key: 'refresh', label: 'Refreshes', value: metrics.value.totals.refresh },
  { key: 'logout', label: 'Sign-outs', value: metrics.value.totals.logout },
  { key: 'revoked', label: 'Revocations', value: metrics.value.totals.revoked },
])

/** Bars share one scale across every column so days and series compare honestly. */
const maxDaily = computed(() =>
  Math.max(1, ...metrics.value.daily.flatMap((d) => [d.login_success, d.login_failure, d.token_issued, d.refresh])),
)
const barStyle = (value: number) => ({ width: `${Math.round((value / maxDaily.value) * 100)}%` })

const getAuthHeaders = () => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

const loadOverview = async () => {
  loading.value = true
  try {
    const data = await $fetch<OverviewResponse>(`${config.public.apiBase}/admin/overview`, {
      query: { tenant_id: tenantId.value },
      headers: getAuthHeaders(),
    })
    overview.value = data
  } finally {
    loading.value = false
  }
}

const loadMetrics = async () => {
  if (!tenantId.value) return
  metricsError.value = ''
  try {
    metrics.value = await $fetch<MetricsResponse>(`${config.public.apiBase}/admin/metrics`, {
      query: { tenant_id: tenantId.value, days: 7 },
      headers: getAuthHeaders(),
    })
  } catch (err: any) {
    metricsError.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Failed to load metrics'
  }
}

const refresh = async () => {
  await Promise.all([loadOverview(), loadMetrics()])
}

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
  tenantId.value = storedTokenTenantId()
  void refresh()
})
</script>

<style scoped>
.admin-home {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.admin-header {
  margin-bottom: 8px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.section-title {
  font-size: 1.375rem;
  font-weight: 400;
  color: #1f1f1f;
  margin: 0;
}

.tenant-selector {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.tenant-input {
  width: 200px;
}

.stats-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #5f6368;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 2rem;
  font-weight: 400;
  color: #1a73e8;
}

.stat-link {
  font-size: 0.75rem;
  color: #1a73e8;
  text-decoration: none;
  font-weight: 500;
}

.stat-link:hover {
  text-decoration: underline;
}

.metrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.metrics-header h3,
.client-list h4 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0;
}

.client-list h4 {
  font-size: 0.875rem;
  margin: 20px 0 8px;
}

.metrics-error {
  font-size: 0.75rem;
  color: #d93025;
}

.metric-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.metric-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid #dadce0;
  border-radius: 8px;
}

.metric-value {
  font-size: 1.5rem;
  color: #1a73e8;
}

.metric-value.metric-bad {
  color: #d93025;
}

.daily-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8125rem;
}

.daily-row {
  display: grid;
  grid-template-columns: 110px repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: center;
}

.daily-head {
  font-size: 0.75rem;
  font-weight: 500;
  color: #5f6368;
}

.day-label {
  color: #444746;
  font-variant-numeric: tabular-nums;
}

.bar-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

.bar {
  display: inline-block;
  height: 8px;
  min-width: 2px;
  max-width: 70%;
  border-radius: 4px;
  background: #8ab4f8;
}

.bar-ok { background: #81c995; }
.bar-bad { background: #f28b82; }

.metrics-empty {
  font-size: 0.875rem;
  color: #5f6368;
}

.client-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) 1fr 1fr;
  gap: 12px;
  font-size: 0.8125rem;
  padding: 6px 0;
  border-bottom: 1px solid #f1f3f4;
}

.client-id {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}

.management-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  color: #1a73e8;
}

.card-title h3 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0;
}

.card-desc {
  font-size: 0.875rem;
  color: #444746;
  line-height: 1.5rem;
  margin-bottom: 24px;
  flex: 1;
}

.card-action {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1a73e8;
  text-decoration: none;
  padding: 8px 16px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  align-self: flex-start;
  transition: background-color 0.2s;
}

.card-action:hover {
  background-color: #f7f9fc;
}

@media (max-width: 600px) {
  .daily-row {
    grid-template-columns: 80px repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .header-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}
</style>
