<template>
  <div class="apps-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Applications</h2>
        <p>Manage OIDC clients and bootstrap standard application environments.</p>
      </div>
      <div class="header-controls">
        <UiInput v-model="tenantId" label="Tenant ID" class="control-input" />
        <UiCheckbox v-model="includeDisabled" label="Show disabled" class="checkbox-control" />
        <UiButton variant="ghost" @click="loadClients" :loading="loading">
          Refresh
        </UiButton>
      </div>
    </div>

    <div class="admin-grid">
      <UiCard class="info-card" title="Quick Bootstrap" subtitle="Automatically create tenants, clients, and default roles for standard applications.">
        <div class="bootstrap-actions">
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['blog'])" :loading="loading">Blog</UiButton>
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['paste'])" :loading="loading">Paste</UiButton>
          <UiButton variant="outline" size="sm" @click="bootstrapApps(['cherry'])" :loading="loading">Cherry</UiButton>
          <UiButton variant="primary" size="sm" @click="bootstrapApps(['cherry', 'paste'])" :loading="loading">
            Bootstrap First Batch
          </UiButton>
        </div>

        <UiAlert v-if="bootstrapMessage || bootstrapRunId" variant="info" class="bootstrap-status">
          <p v-if="bootstrapMessage" class="status-text">{{ bootstrapMessage }}</p>
          <div v-if="bootstrapRunId" class="run-info">
            <span>Run ID: <code>{{ bootstrapRunId }}</code></span>
            <UiButton variant="ghost" size="sm" @click="loadBootstrapReceipts()">Refresh Receipts</UiButton>
          </div>
        </UiAlert>

        <UiTableShell
          v-if="bootstrapReceipts.length"
          :columns="receiptColumns"
          :rows="bootstrapReceipts"
          empty-text="No bootstrap receipts yet."
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'app_key'">
              <span class="font-medium">{{ asReceipt(row).app_key }}</span>
            </template>
            <template v-else-if="column.key === 'tenant_id'">
              <span>{{ asReceipt(row).tenant_id }}</span>
            </template>
            <template v-else-if="column.key === 'clients'">
              <span class="text-xs">{{ asReceipt(row).clients.join(', ') }}</span>
            </template>
            <template v-else-if="column.key === 'created_at'">
              <span>{{ formatCreatedAt(asReceipt(row).created_at) }}</span>
            </template>
          </template>
        </UiTableShell>
      </UiCard>

      <UiCard class="info-card" title="Create OIDC Client" subtitle="Register a new application client with custom OIDC parameters.">
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
      </UiCard>

      <UiCard class="info-card wide-card">
        <template #header>
          <div class="card-header">
            <h3>OIDC Clients</h3>
            <UiBadge variant="info" :label="String(clients.length)" />
          </div>
        </template>

        <UiAlert v-if="error" variant="danger" :message="error" class="error-alert" />

        <UiTableShell
          :columns="clientColumns"
          :rows="clients"
          empty-text="No clients found for this tenant."
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'client_id'">
              <span class="font-medium">{{ asClient(row).client_id }}</span>
            </template>
            <template v-else-if="column.key === 'name'">
              <UiInput v-if="editingId === asClient(row).id" v-model="editForm.name" class="table-input" />
              <span v-else>{{ asClient(row).name }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <UiBadge :variant="statusBadgeVariant(asClient(row).status)" :label="asClient(row).status" />
            </template>
            <template v-else-if="column.key === 'grant_types'">
              <UiInput v-if="editingId === asClient(row).id" v-model="editForm.grant_types" class="table-input" />
              <span v-else>{{ asClient(row).grant_types }}</span>
            </template>
            <template v-else-if="column.key === 'scope'">
              <UiInput v-if="editingId === asClient(row).id" v-model="editForm.scope" class="table-input" />
              <span v-else>{{ asClient(row).scope }}</span>
            </template>
            <template v-else-if="column.key === 'redirect_uris'">
              <UiInput v-if="editingId === asClient(row).id" v-model="editForm.redirect_uris" class="table-input" />
              <span v-else class="text-xs">{{ asClient(row).redirect_uris.join(', ') }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <div class="table-actions">
                <template v-if="editingId === asClient(row).id">
                  <UiButton variant="primary" size="sm" @click="saveEdit(asClient(row).id)" :loading="loading">Save</UiButton>
                  <UiButton variant="ghost" size="sm" @click="cancelEdit" :disabled="loading">Cancel</UiButton>
                </template>
                <template v-else>
                  <UiButton variant="ghost" size="sm" @click="startEdit(asClient(row))" :disabled="loading">Edit</UiButton>
                  <UiButton
                    :variant="asClient(row).status === 'active' ? 'ghost' : 'outline'"
                    size="sm"
                    @click="toggleClientStatus(asClient(row))"
                    :disabled="loading"
                    :class="{ 'text-danger': asClient(row).status === 'active' }"
                  >
                    {{ asClient(row).status === 'active' ? 'Disable' : 'Enable' }}
                  </UiButton>
                </template>
              </div>
            </template>
          </template>
        </UiTableShell>
      </UiCard>
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

.wide-card {
  grid-column: span 2;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.card-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
}

.bootstrap-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.bootstrap-status {
  margin-top: 8px;
}

.status-text {
  font-size: 0.875rem;
  color: #1f1f1f;
  margin: 0 0 8px;
}

.run-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: #5f6368;
}

.error-alert {
  margin-bottom: 12px;
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

.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.text-danger { color: #d93025; }

.table-input {
  min-width: 120px;
}

.table-actions {
  display: flex;
  gap: 6px;
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

const receiptColumns = [
  { key: 'app_key', label: 'App' },
  { key: 'tenant_id', label: 'Tenant' },
  { key: 'clients', label: 'Clients' },
  { key: 'created_at', label: 'Created At' },
]

const clientColumns = [
  { key: 'client_id', label: 'Client ID' },
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'grant_types', label: 'Grant Types' },
  { key: 'scope', label: 'Scope' },
  { key: 'redirect_uris', label: 'Redirect URIs' },
  { key: 'actions', label: 'Actions' },
]

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

const asReceipt = (row: Record<string, unknown>) => row as unknown as BootstrapReceipt
const asClient = (row: Record<string, unknown>) => row as unknown as ClientItem

const statusBadgeVariant = (status: ClientItem['status']) => {
  return status === 'active' ? 'success' : 'danger'
}

const formatCreatedAt = (createdAt: number) => {
  return new Date(createdAt * 1000).toLocaleString()
}

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
