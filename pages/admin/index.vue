<template>
  <div class="admin-home">
    <div class="admin-header">
      <div class="header-content">
        <h2 class="section-title">Overview</h2>
        <div class="tenant-selector">
          <UiInput v-model="tenantId" label="Tenant ID" class="tenant-input" />
          <UiButton variant="ghost" @click="loadOverview" :loading="loading">
            Refresh
          </UiButton>
        </div>
      </div>
    </div>

    <div class="stats-container">
      <div v-for="item in stats" :key="item.label" class="stat-card">
        <div class="stat-info">
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-value">{{ item.value }}</span>
        </div>
        <div class="stat-footer">
          <NuxtLink :to="item.link" class="stat-link">View details</NuxtLink>
        </div>
      </div>
    </div>

    <div class="management-grid">
      <div class="management-card">
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
      </div>

      <div class="management-card">
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
      </div>

      <div class="management-card">
        <div class="card-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <h3>Billing & Subscriptions</h3>
        </div>
        <p class="card-desc">Monitor usage, manage product plans, and handle entitlement transitions for your tenants.</p>
        <NuxtLink to="/admin/billing" class="card-action">Manage Billing</NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
type OverviewResponse = {
  tenant_id: string
  users: number
  clients: number
  roles: number
  active_sessions: number
}

const config = useRuntimeConfig()
const tenantId = ref('tenant-demo')
const loading = ref(false)
const overview = ref<OverviewResponse>({
  tenant_id: 'tenant-demo',
  users: 0,
  clients: 0,
  roles: 0,
  active_sessions: 0,
})

const stats = computed(() => [
  { label: 'Active Users', value: overview.value.users, link: '/admin/access' },
  { label: 'OIDC Clients', value: overview.value.clients, link: '/admin/apps' },
  { label: 'Custom Roles', value: overview.value.roles, link: '/admin/access' },
  { label: 'Active Sessions', value: overview.value.active_sessions, link: '/portal' },
])

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

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
  loadOverview()
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

.stat-card {
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.stat-info {
  padding: 16px;
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

.stat-footer {
  padding: 8px 16px;
  border-top: 1px solid #f1f3f4;
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

.management-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.management-card {
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
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
  .header-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}
</style>
