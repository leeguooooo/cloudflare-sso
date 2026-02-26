<template>
  <NuxtLayout name="default">
    <div class="apps-page">
      <section class="toolbar">
        <label>
          Tenant
          <input v-model="tenantId" class="field" />
        </label>
        <label class="checkbox">
          <input v-model="includeDisabled" type="checkbox" />
          Show disabled
        </label>
        <button class="btn-primary" @click="loadClients" :disabled="loading">
          {{ loading ? 'Loading...' : 'Reload Clients' }}
        </button>
      </section>

      <section class="card">
        <h2>Quick Bootstrap</h2>
        <p class="muted">为标准应用自动创建租户、客户端与默认角色，支持首批客户端一键注册。</p>
        <div class="actions">
          <button class="btn-secondary btn-sm" @click="bootstrapApps(['blog'])" :disabled="loading">Bootstrap blog</button>
          <button class="btn-secondary btn-sm" @click="bootstrapApps(['paste'])" :disabled="loading">Bootstrap paste</button>
          <button class="btn-secondary btn-sm" @click="bootstrapApps(['cherry'])" :disabled="loading">Bootstrap cherry</button>
          <button class="btn-primary btn-sm" @click="bootstrapApps(['cherry', 'paste'])" :disabled="loading">
            Bootstrap first batch
          </button>
        </div>
        <p v-if="bootstrapMessage" class="muted">{{ bootstrapMessage }}</p>
        <p v-if="bootstrapRunId" class="muted">Run ID: <code>{{ bootstrapRunId }}</code></p>
        <button class="btn-secondary btn-sm" @click="loadBootstrapReceipts()" :disabled="loading || !bootstrapRunId">
          Refresh Receipts
        </button>
        <table v-if="bootstrapReceipts.length" class="table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>App</th>
              <th>Tenant</th>
              <th>Clients</th>
              <th>Created At (Unix)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="receipt in bootstrapReceipts" :key="receipt.audit_id">
              <td class="small">{{ receipt.bootstrap_run_id }}</td>
              <td>{{ receipt.app_key }}</td>
              <td>{{ receipt.tenant_id }}</td>
              <td>{{ receipt.clients.join(', ') }}</td>
              <td>{{ receipt.created_at }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Create OIDC Client</h2>
        <p class="muted">支持 blog/paste/cherry 之外的新应用快速注册。</p>
        <div class="form-grid">
          <label>
            Client ID
            <input v-model="createForm.client_id" class="field" placeholder="sample-web" />
          </label>
          <label>
            Name
            <input v-model="createForm.name" class="field" placeholder="Sample Web" />
          </label>
          <label>
            Redirect URIs (comma separated)
            <input v-model="createForm.redirect_uris" class="field" placeholder="http://localhost:3000/callback" />
          </label>
          <label>
            Grant Types
            <input v-model="createForm.grant_types" class="field" />
          </label>
          <label>
            Scope
            <input v-model="createForm.scope" class="field" />
          </label>
          <button class="btn-primary" @click="createClient" :disabled="loading">
            Create
          </button>
        </div>
      </section>

      <section class="card">
        <h2>OIDC Clients</h2>
        <p v-if="error" class="error">{{ error }}</p>
        <table class="table">
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Grant Types</th>
              <th>Scope</th>
              <th>Redirect URIs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="client in clients" :key="client.id">
              <td>{{ client.client_id }}</td>
              <td>
                <input v-if="editingId === client.id" v-model="editForm.name" class="field compact" />
                <span v-else>{{ client.name }}</span>
              </td>
              <td>
                <span class="badge" :class="client.status">{{ client.status }}</span>
              </td>
              <td>
                <input v-if="editingId === client.id" v-model="editForm.grant_types" class="field compact" />
                <span v-else>{{ client.grant_types }}</span>
              </td>
              <td>
                <input v-if="editingId === client.id" v-model="editForm.scope" class="field compact" />
                <span v-else>{{ client.scope }}</span>
              </td>
              <td class="small">
                <input
                  v-if="editingId === client.id"
                  v-model="editForm.redirect_uris"
                  class="field compact"
                />
                <span v-else>{{ client.redirect_uris.join(', ') }}</span>
              </td>
              <td>
                <div class="actions">
                  <template v-if="editingId === client.id">
                    <button class="btn-primary btn-sm" @click="saveEdit(client.id)" :disabled="loading">Save</button>
                    <button class="btn-secondary btn-sm" @click="cancelEdit" :disabled="loading">Cancel</button>
                  </template>
                  <template v-else>
                    <button class="btn-secondary btn-sm" @click="startEdit(client)" :disabled="loading">Edit</button>
                    <button
                      class="btn-danger btn-sm"
                      @click="toggleClientStatus(client)"
                      :disabled="loading"
                    >
                      {{ client.status === 'active' ? 'Disable' : 'Enable' }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
            <tr v-if="clients.length === 0">
              <td colspan="7" class="muted">No clients found for this tenant.</td>
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
  redirect_uris: string[]
  grant_types: string
  scope: string
  first_party: number
  status: 'active' | 'disabled'
}

type ClientListResponse = {
  tenant_id: string
  clients: ClientItem[]
}

type BootstrapResult = {
  app_key: string
  tenant_id: string
  client_ids: string[]
  default_roles: string[]
  provisioned_admin_user_id: string | null
  bootstrap_run_id: string
}

type BootstrapResponse =
  | BootstrapResult
  | {
      app_keys: string[]
      bootstrap_run_id: string
      results: BootstrapResult[]
    }

type BootstrapReceipt = {
  audit_id: string
  bootstrap_run_id: string
  app_key: string
  tenant_id: string
  clients: string[]
  created_at: number
}

type BootstrapReceiptResponse = {
  run_id: string | null
  receipts: BootstrapReceipt[]
}

const config = useRuntimeConfig()
const tenantId = ref('tenant-demo')
const includeDisabled = ref(false)
const loading = ref(false)
const error = ref('')
const bootstrapMessage = ref('')
const bootstrapRunId = ref('')
const bootstrapReceipts = ref<BootstrapReceipt[]>([])
const clients = ref<ClientItem[]>([])
const editingId = ref('')
const editForm = reactive({
  name: '',
  grant_types: '',
  scope: '',
  redirect_uris: '',
})

const createForm = reactive({
  client_id: '',
  name: '',
  redirect_uris: '',
  grant_types: 'authorization_code pkce refresh_token',
  scope: 'openid profile email',
})

const splitUris = (raw: string) => {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const getAuthHeaders = () => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token')
  if (!token) {
    navigateTo('/login')
    return {}
  }
  return { authorization: `Bearer ${token}` }
}

const loadClients = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<ClientListResponse>(`${config.public.apiBase}/admin/clients`, {
      query: {
        tenant_id: tenantId.value,
        include_disabled: includeDisabled.value ? 'true' : 'false',
      },
      headers: getAuthHeaders(),
    })
    clients.value = data.clients || []
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Load clients failed'
  } finally {
    loading.value = false
  }
}

const bootstrapApps = async (appKeys: string[]) => {
  loading.value = true
  error.value = ''
  bootstrapMessage.value = ''
  bootstrapRunId.value = ''
  bootstrapReceipts.value = []
  try {
    const data = await $fetch<BootstrapResponse>(`${config.public.apiBase}/admin/apps/bootstrap`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: appKeys.length === 1 ? { app_key: appKeys[0] } : { app_keys: appKeys },
    })
    const results = 'results' in data ? data.results : [data]
    bootstrapRunId.value = 'bootstrap_run_id' in data ? data.bootstrap_run_id : (results[0]?.bootstrap_run_id || '')
    bootstrapMessage.value = results
      .map((item) => `${item.app_key}: ${item.client_ids.join(', ')}`)
      .join(' | ')
    await loadBootstrapReceipts(bootstrapRunId.value)
    if (results.some((item) => item.tenant_id === tenantId.value)) {
      await loadClients()
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Bootstrap failed'
  } finally {
    loading.value = false
  }
}

const loadBootstrapReceipts = async (runId = bootstrapRunId.value) => {
  if (!runId) return
  try {
    const data = await $fetch<BootstrapReceiptResponse>(`${config.public.apiBase}/admin/apps/bootstrap-runs`, {
      headers: getAuthHeaders(),
      query: {
        run_id: runId,
        limit: 20,
      },
    })
    bootstrapReceipts.value = data.receipts || []
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Load bootstrap receipts failed'
  }
}

const manageClient = async (payload: Record<string, unknown>) => {
  await $fetch(`${config.public.apiBase}/admin/clients`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: {
      tenant_id: tenantId.value,
      ...payload,
    },
  })
}

const createClient = async () => {
  loading.value = true
  error.value = ''
  try {
    await manageClient({
      action: 'create',
      client_id: createForm.client_id.trim(),
      name: createForm.name.trim(),
      redirect_uris: splitUris(createForm.redirect_uris),
      grant_types: createForm.grant_types.trim(),
      scope: createForm.scope.trim(),
    })
    createForm.client_id = ''
    createForm.name = ''
    createForm.redirect_uris = ''
    await loadClients()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Create client failed'
  } finally {
    loading.value = false
  }
}

const startEdit = (client: ClientItem) => {
  editingId.value = client.id
  editForm.name = client.name
  editForm.grant_types = client.grant_types
  editForm.scope = client.scope
  editForm.redirect_uris = client.redirect_uris.join(', ')
}

const cancelEdit = () => {
  editingId.value = ''
  editForm.name = ''
  editForm.grant_types = ''
  editForm.scope = ''
  editForm.redirect_uris = ''
}

const saveEdit = async (id: string) => {
  loading.value = true
  error.value = ''
  try {
    await manageClient({
      action: 'update',
      id,
      name: editForm.name.trim(),
      grant_types: editForm.grant_types.trim(),
      scope: editForm.scope.trim(),
      redirect_uris: splitUris(editForm.redirect_uris),
    })
    cancelEdit()
    await loadClients()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update client failed'
  } finally {
    loading.value = false
  }
}

const toggleClientStatus = async (client: ClientItem) => {
  loading.value = true
  error.value = ''
  try {
    await manageClient({
      action: client.status === 'active' ? 'disable' : 'enable',
      id: client.id,
    })
    await loadClients()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update client status failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
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
  flex-wrap: wrap;
}

.toolbar label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.checkbox {
  flex-direction: row !important;
  align-items: center;
  gap: 0.45rem !important;
  padding-bottom: 0.4rem;
}

.field {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  min-width: 180px;
}

.field.compact {
  min-width: 0;
  width: 100%;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  border-radius: var(--radius-md);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary {
  border-color: var(--color-primary-600);
  background: var(--color-primary-600);
  color: white;
}

.btn-secondary {
  border-color: var(--color-border);
  background: white;
  color: var(--color-text-primary);
}

.btn-danger {
  border-color: #b3261e;
  background: #b3261e;
  color: white;
}

.btn-sm {
  padding: 0.4rem 0.55rem;
  font-size: 0.75rem;
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

.error {
  color: #b3261e;
  margin-bottom: 0.5rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: 0.82rem;
}

.table th,
.table td {
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  padding: 0.625rem;
  vertical-align: top;
}

.small {
  max-width: 260px;
  word-break: break-all;
}

.actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
}

.badge.active {
  background: #e8f5e9;
  color: #137333;
}

.badge.disabled {
  background: #fce8e6;
  color: #b3261e;
}

@media (max-width: 1080px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .table {
    font-size: 0.75rem;
  }
}
</style>
