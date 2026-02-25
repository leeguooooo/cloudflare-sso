<template>
  <NuxtLayout name="default">
    <div class="apps-page">
      <section class="toolbar">
        <label>
          Tenant
          <input v-model="tenantId" class="field" />
        </label>
        <button class="btn-primary" @click="loadClients" :disabled="loading">
          {{ loading ? 'Loading...' : 'Reload Clients' }}
        </button>
      </section>

      <section class="card">
        <h2>OIDC Clients</h2>
        <p class="muted">Manage app registrations for blog, paste, and future products.</p>
        <table class="table">
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Name</th>
              <th>Grant Types</th>
              <th>Scopes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="client in clients" :key="client.id">
              <td>{{ client.client_id }}</td>
              <td>{{ client.name }}</td>
              <td>{{ client.grant_types }}</td>
              <td>{{ client.scope }}</td>
            </tr>
            <tr v-if="clients.length === 0">
              <td colspan="4" class="muted">No clients found for this tenant.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
type ClientItem = {
  id: string
  client_id: string
  name: string
  grant_types: string
  scope: string
}

const config = useRuntimeConfig()
const tenantId = ref('tenant-demo')
const loading = ref(false)
const clients = ref<ClientItem[]>([])

const loadClients = async () => {
  loading.value = true
  try {
    const data = await $fetch<{ tenant_id: string; clients: ClientItem[] }>(`${config.public.apiBase}/admin/clients`, {
      query: { tenant_id: tenantId.value },
    })
    clients.value = data.clients || []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadClients()
})
</script>

<style scoped>
.apps-page {
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

.card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.card h2 {
  margin-bottom: 0.5rem;
}

.muted {
  color: var(--color-text-secondary);
}

.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: var(--font-size-sm);
}

.table th,
.table td {
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  padding: 0.625rem;
}

@media (max-width: 860px) {
  .table {
    font-size: 0.75rem;
  }
}
</style>
