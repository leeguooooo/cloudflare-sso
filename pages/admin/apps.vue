<template>
  <div class="apps-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Applications</h2>
        <p>Manage OIDC clients and bootstrap standard application environments.</p>
      </div>
      <div class="header-controls">
        <UiInput v-model="tenantId" label="Tenant ID" class="control-input" />
        <label class="checkbox-control">
          <input v-model="includeDisabled" type="checkbox" />
          <span>Show disabled</span>
        </label>
        <UiButton variant="ghost" @click="loadClients" :loading="loading">
          Refresh
        </UiButton>
      </div>
    </div>

    <div class="admin-grid">
      <!-- Quick Bootstrap Card -->
      <section class="info-card">
        <div class="card-header">
          <h3>Quick Bootstrap</h3>
        </div>
        <p class="card-desc">Automatically create tenants, clients, and default roles for standard applications.</p>
        <div class="bootstrap-actions">
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['blog'])" :loading="loading">Blog</UiButton>
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['paste'])" :loading="loading">Paste</UiButton>
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['cherry'])" :loading="loading">Cherry</UiButton>
          <UiButton variant="primary" size="sm" @click="bootstrapApps(['cherry', 'paste'])" :loading="loading">
            Bootstrap First Batch
          </UiButton>
        </div>
        
        <div v-if="bootstrapMessage || bootstrapRunId" class="bootstrap-status">
          <p v-if="bootstrapMessage" class="status-text">{{ bootstrapMessage }}</p>
          <div v-if="bootstrapRunId" class="run-info">
            <span>Run ID: <code>{{ bootstrapRunId }}</code></span>
            <UiButton variant="ghost" size="sm" @click="loadBootstrapReceipts()">Refresh Receipts</UiButton>
          </div>
        </div>

        <div v-if="bootstrapReceipts.length" class="table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Tenant</th>
                <th>Clients</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="receipt in bootstrapReceipts" :key="receipt.audit_id">
                <td class="font-medium">{{ receipt.app_key }}</td>
                <td>{{ receipt.tenant_id }}</td>
                <td class="text-xs">{{ receipt.clients.join(', ') }}</td>
                <td>{{ new Date(receipt.created_at * 1000).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Create OIDC Client Card -->
      <section class="info-card">
        <div class="card-header">
          <h3>Create OIDC Client</h3>
        </div>
        <p class="card-desc">Register a new application client with custom OIDC parameters.</p>
        <form @submit.prevent="createClient" class="admin-form">
          <div class="form-grid">
            <UiInput v-model="createForm.client_id" label="Client ID" placeholder="sample-web" required />
            <UiInput v-model="createForm.name" label="Name" placeholder="Sample Web" required />
            <UiInput v-model="createForm.redirect_uris" label="Redirect URIs" placeholder="http://localhost:3000/callback" required />
            <UiInput v-model="createForm.grant_types" label="Grant Types" />
            <UiInput v-model="createForm.scope" label="Scope" />
          </div>
          <div class="form-actions">
            <UiButton type="submit" variant="primary" :loading="loading">Create Client</UiButton>
          </div>
        </form>
      </section>

      <!-- Clients Table Card -->
      <section class="info-card wide-card">
        <div class="card-header">
          <h3>OIDC Clients</h3>
          <span class="badge">{{ clients.length }}</span>
        </div>
        <div v-if="error" class="error-banner">{{ error }}</div>
        <div class="table-container">
          <table class="admin-table">
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
                <td class="font-medium">{{ client.client_id }}</td>
                <td>
                  <UiInput v-if="editingId === client.id" v-model="editForm.name" class="table-input" />
                  <span v-else>{{ client.name }}</span>
                </td>
                <td>
                  <span class="status-badge" :class="client.status">{{ client.status }}</span>
                </td>
                <td>
                  <UiInput v-if="editingId === client.id" v-model="editForm.grant_types" class="table-input" />
                  <span v-else>{{ client.grant_types }}</span>
                </td>
                <td>
                  <UiInput v-if="editingId === client.id" v-model="editForm.scope" class="table-input" />
                  <span v-else>{{ client.scope }}</span>
                </td>
                <td class="text-xs">
                  <UiInput v-if="editingId === client.id" v-model="editForm.redirect_uris" class="table-input" />
                  <span v-else>{{ client.redirect_uris.join(', ') }}</span>
                </td>
                <td>
                  <div class="table-actions">
                    <template v-if="editingId === client.id">
                      <UiButton variant="primary" size="sm" @click="saveEdit(client.id)" :loading="loading">Save</UiButton>
                      <UiButton variant="ghost" size="sm" @click="cancelEdit" :disabled="loading">Cancel</UiButton>
                    </template>
                    <template v-else>
                      <UiButton variant="ghost" size="sm" @click="startEdit(client)" :disabled="loading">Edit</UiButton>
                      <UiButton
                        :variant="client.status === 'active' ? 'ghost' : 'outline'"
                        size="sm"
                        @click="toggleClientStatus(client)"
                        :disabled="loading"
                        :class="{ 'text-danger': client.status === 'active' }"
                      >
                        {{ client.status === 'active' ? 'Disable' : 'Enable' }}
                      </UiButton>
                    </template>
                  </div>
                </td>
              </tr>
              <tr v-if="clients.length === 0">
                <td colspan="7" class="empty-row">No clients found for this tenant.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.apps-page {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 8px;
}

.header-text h2 {
  font-size: 1.375rem;
  font-weight: 400;
  color: #1f1f1f;
  margin-bottom: 4px;
}

.header-text p {
  color: #5f6368;
  font-size: 0.875rem;
}

.header-controls {
  display: flex;
  gap: 16px;
  align-items: center;
}

.control-input {
  width: 160px;
}

.checkbox-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: #444746;
  cursor: pointer;
  padding-bottom: 4px;
}

.admin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 24px;
}

.info-card {
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.wide-card {
  grid-column: span 2;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.card-header h3 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0;
}

.badge {
  background-color: #e8f0fe;
  color: #1a73e8;
  padding: 2px 12px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.card-desc {
  font-size: 0.875rem;
  color: #444746;
  line-height: 1.5rem;
  margin-bottom: 24px;
}

.bootstrap-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.bootstrap-status {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.status-text {
  font-size: 0.875rem;
  color: #1f1f1f;
  margin-bottom: 8px;
}

.run-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: #5f6368;
}

.admin-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.table-container {
  overflow-x: auto;
  border: 1px solid #dadce0;
  border-radius: 8px;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.admin-table th {
  text-align: left;
  padding: 12px 16px;
  background-color: #f8f9fa;
  border-bottom: 1px solid #dadce0;
  color: #5f6368;
  font-weight: 500;
  white-space: nowrap;
}

.admin-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f3f4;
  color: #1f1f1f;
  vertical-align: middle;
}

.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.text-danger { color: #d93025; }

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge.active { background-color: #e6f4ea; color: #137333; }
.status-badge.disabled { background-color: #fce8e6; color: #d93025; }

.table-input {
  min-width: 120px;
}

.table-actions {
  display: flex;
  gap: 4px;
}

.empty-row {
  text-align: center;
  color: #5f6368;
  padding: 32px !important;
}

.error-banner {
  background-color: #fce8e6;
  color: #d93025;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  .wide-card {
    grid-column: span 1;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

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
