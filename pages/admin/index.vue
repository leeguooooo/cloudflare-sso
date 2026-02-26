<template>
  <NuxtLayout name="default">
    <div class="admin-home">
      <section class="toolbar">
        <label>
          Tenant
          <input v-model="tenantId" class="field" />
        </label>
        <button class="btn-primary" @click="loadOverview" :disabled="loading">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
      </section>

      <section class="stats-grid">
        <article class="stat-card" v-for="item in stats" :key="item.label">
          <p class="label">{{ item.label }}</p>
          <p class="value">{{ item.value }}</p>
        </article>
      </section>

      <section class="quick-links">
        <NuxtLink to="/admin/access" class="link-card">
          <h3>Access Control</h3>
          <p>Role, permission, and assignment management.</p>
        </NuxtLink>
        <NuxtLink to="/admin/apps" class="link-card">
          <h3>Application Clients</h3>
          <p>OIDC clients and redirect URI governance.</p>
        </NuxtLink>
        <NuxtLink to="/admin/billing" class="link-card">
          <h3>Billing Console</h3>
          <p>Product plans and entitlement operations.</p>
        </NuxtLink>
      </section>
    </div>
  </NuxtLayout>
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
  { label: 'Users', value: overview.value.users },
  { label: 'OIDC Clients', value: overview.value.clients },
  { label: 'Roles', value: overview.value.roles },
  { label: 'Active Sessions', value: overview.value.active_sessions },
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
  gap: 1rem;
}

.toolbar {
  display: flex;
  align-items: end;
  gap: 0.75rem;
}

.toolbar label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.field {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.btn-primary {
  border-radius: var(--radius-md);
  border: 1px solid var(--color-primary-600);
  background: var(--color-primary-600);
  color: white;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.stat-card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.value {
  font-size: 1.5rem;
  font-weight: 700;
}

.quick-links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.link-card {
  display: block;
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.link-card h3 {
  font-size: 1rem;
  margin-bottom: 0.5rem;
}

.link-card p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

@media (max-width: 980px) {
  .stats-grid,
  .quick-links {
    grid-template-columns: 1fr;
  }
}
</style>
