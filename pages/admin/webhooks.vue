<template>
  <div class="webhooks-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Webhooks</h2>
        <p>Your app's backend gets a signed POST when one of its users is suspended, deleted, merged or their membership changes.</p>
      </div>
      <div class="header-controls">
        <AdminTenantPicker v-model="tenantId" class="control" @change="load" />
      </div>
    </div>

    <UiAlert v-if="error" variant="danger" :message="error" />
    <UiAlert v-if="message" variant="success" :message="message" />

    <UiCard v-if="secret" class="secret-card">
      <p class="font-medium">Signing secret — copy it now, it is not shown again:</p>
      <code class="secret">{{ secret }}</code>
      <p class="hint">
        Verify each request: <code>X-Leeguoo-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> where v1 = HMAC-SHA256(secret,
        <code>"&lt;t&gt;.&lt;raw body&gt;"</code>). Reject old timestamps, and dedupe on <code>X-Leeguoo-Delivery</code>.
      </p>
      <UiButton variant="ghost" size="sm" @click="secret = ''">Done</UiButton>
    </UiCard>

    <UiCard>
      <template #header><h3>Add endpoint</h3></template>
      <form class="create-form" @submit.prevent="create">
        <UiInput v-model="form.url" label="URL (https)" placeholder="https://api.example.com/sso/webhook" class="url-input" required />
        <UiInput v-model="form.description" label="Description" placeholder="Paste API" class="desc-input" />
        <UiButton type="submit" :disabled="busy || !form.url">Add</UiButton>
      </form>
      <div class="events">
        <UiCheckbox v-model="form.all" label="All events" />
        <template v-if="!form.all">
          <UiCheckbox v-for="name in catalog" :key="name" :model-value="form.events.includes(name)" :label="name" @update:model-value="toggle(name, $event)" />
        </template>
      </div>
    </UiCard>

    <UiCard v-for="endpoint in endpoints" :key="endpoint.id">
      <div class="endpoint">
        <div class="endpoint-text">
          <div class="font-medium mono">{{ endpoint.url }}</div>
          <div class="text-xs muted">{{ endpoint.description || endpoint.id }}</div>
          <div class="badge-row">
            <UiBadge :variant="endpoint.status === 'active' ? 'success' : 'neutral'" :label="endpoint.status" />
            <UiBadge v-for="name in endpoint.events" :key="name" variant="neutral" :label="name === '*' ? 'all events' : name" />
          </div>
          <div class="text-xs muted">
            Last 7 days: {{ endpoint.last_7_days.succeeded || 0 }} delivered · {{ endpoint.last_7_days.pending || 0 }} retrying ·
            {{ endpoint.last_7_days.failed || 0 }} failed
          </div>
        </div>
        <div class="endpoint-actions">
          <UiButton variant="ghost" size="sm" :disabled="busy || endpoint.status !== 'active'" @click="act(endpoint.id, 'test')">Send test</UiButton>
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="showDeliveries(endpoint.id)">Deliveries</UiButton>
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="act(endpoint.id, endpoint.status === 'active' ? 'disable' : 'enable')">
            {{ endpoint.status === 'active' ? 'Disable' : 'Enable' }}
          </UiButton>
          <UiButton variant="ghost" size="sm" :disabled="busy" @click="act(endpoint.id, 'rotate_secret', 'Rotate the signing secret? The old one stops working at once.')">Rotate secret</UiButton>
          <UiButton variant="ghost" size="sm" class="bad" :disabled="busy" @click="act(endpoint.id, 'delete', 'Delete this endpoint and its delivery history?')">Delete</UiButton>
        </div>
      </div>

      <div v-if="openEndpoint === endpoint.id" class="deliveries">
        <UiTableShell :columns="deliveryColumns" :rows="deliveries" empty-text="No deliveries yet.">
          <template #cell="{ row, column }">
            <template v-if="column.key === 'event_type'">
              <span class="mono text-xs">{{ row.event_type }}</span>
              <div class="mono text-xs muted">{{ row.id }}</div>
            </template>
            <template v-else-if="column.key === 'status'">
              <UiBadge :variant="row.status === 'succeeded' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" :label="String(row.status)" />
              <div class="text-xs muted">{{ row.attempts }} attempt(s){{ row.last_status ? ` · HTTP ${row.last_status}` : '' }}</div>
            </template>
            <template v-else-if="column.key === 'detail'">
              <span class="text-xs bad">{{ row.last_error || '' }}</span>
              <div v-if="row.status === 'pending' && row.next_attempt_at" class="text-xs muted">next try {{ formatAdminTime(row.next_attempt_at as number) }}</div>
            </template>
            <template v-else-if="column.key === 'created_at'">
              <span class="text-xs">{{ formatAdminTime(row.created_at as number) }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <UiButton variant="ghost" size="sm" :disabled="busy" @click="redeliver(String(row.id))">Redeliver</UiButton>
            </template>
          </template>
        </UiTableShell>
      </div>
    </UiCard>

    <p v-if="!endpoints.length && !loading" class="muted">No endpoints yet for this tenant.</p>
  </div>
</template>

<script setup lang="ts">
type Endpoint = { id: string; url: string; description: string | null; status: string; events: string[]; last_7_days: Record<string, number> }
type Action = 'test' | 'disable' | 'enable' | 'rotate_secret' | 'delete'

const { get, post, errorText, signedIn } = useAdminApi()
const tenantId = ref('')
const catalog = ref<string[]>([])
const endpoints = ref<Endpoint[]>([])
const deliveries = ref<Record<string, unknown>[]>([])
const openEndpoint = ref('')
const secret = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const form = reactive({ url: '', description: '', all: true, events: [] as string[] })

const deliveryColumns = [
  { key: 'event_type', label: 'Event' },
  { key: 'status', label: 'Status' },
  { key: 'detail', label: 'Detail' },
  { key: 'created_at', label: 'Created' },
  { key: 'actions', label: '' },
]

const toggle = (name: string, on: boolean) => {
  form.events = on ? [...new Set([...form.events, name])] : form.events.filter((e) => e !== name)
}

const load = async () => {
  if (!tenantId.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await get<{ events: string[]; endpoints: Endpoint[] }>('/admin/webhooks', { tenant_id: tenantId.value })
    catalog.value = data.events
    endpoints.value = data.endpoints
  } catch (err) {
    error.value = errorText(err, 'Failed to load webhooks')
  } finally {
    loading.value = false
  }
}

const run = async <T>(body: Record<string, unknown>, done: string) => {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const data = await post<T>('/admin/webhooks', { tenant_id: tenantId.value, ...body })
    message.value = done
    await load()
    return data
  } catch (err) {
    error.value = errorText(err, 'Action failed')
    return null
  } finally {
    busy.value = false
  }
}

const create = async () => {
  const data = await run<{ secret: string }>(
    { action: 'create', url: form.url.trim(), description: form.description.trim() || undefined, events: form.all ? '*' : form.events },
    'Endpoint added',
  )
  if (data) {
    secret.value = data.secret
    Object.assign(form, { url: '', description: '', all: true, events: [] })
  }
}

const act = async (endpointId: string, action: Action, confirmText?: string) => {
  if (confirmText && !window.confirm(confirmText)) return
  const DONE: Record<Action, string> = { test: 'Test event sent', disable: 'Disabled', enable: 'Enabled', rotate_secret: 'Secret rotated', delete: 'Deleted' }
  const data = await run<{ secret?: string }>({ action, endpoint_id: endpointId }, DONE[action])
  if (data?.secret) secret.value = data.secret
  if (action === 'test' && openEndpoint.value === endpointId) await showDeliveries(endpointId, true)
}

const showDeliveries = async (endpointId: string, keepOpen = false) => {
  if (openEndpoint.value === endpointId && !keepOpen) {
    openEndpoint.value = ''
    return
  }
  openEndpoint.value = endpointId
  try {
    const data = await get<{ deliveries: Record<string, unknown>[] }>('/admin/webhooks/deliveries', { tenant_id: tenantId.value, endpoint_id: endpointId, limit: 50 })
    deliveries.value = data.deliveries
  } catch (err) {
    error.value = errorText(err, 'Failed to load deliveries')
  }
}

const redeliver = async (deliveryId: string) => {
  busy.value = true
  try {
    const result = await post<{ ok: boolean; status: number; error: string | null }>('/admin/webhooks/deliveries', { tenant_id: tenantId.value, delivery_id: deliveryId })
    message.value = result.ok ? 'Delivered' : `Still failing: ${result.error}`
    await showDeliveries(openEndpoint.value, true)
    await load()
  } catch (err) {
    error.value = errorText(err, 'Redeliver failed')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (!signedIn()) {
    navigateTo('/login')
    return
  }
  void load()
})
</script>

<style scoped>
.webhooks-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
}

.header-text h2 {
  font-size: 1.375rem;
  font-weight: 400;
  color: #1f1f1f;
  margin-bottom: 4px;
}

.header-text p,
.hint {
  color: #5f6368;
  font-size: 0.875rem;
  max-width: 640px;
}

.control {
  width: 240px;
}

h3 {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0;
  color: #1f1f1f;
}

.create-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.url-input {
  flex: 1;
  min-width: 260px;
}

.desc-input {
  width: 200px;
}

.events {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 12px;
}

.endpoint {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.endpoint-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.endpoint-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.deliveries {
  margin-top: 16px;
}

.secret-card .secret {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9375rem;
  margin: 8px 0;
  word-break: break-all;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }
.bad { color: #d93025; }

@media (max-width: 900px) {
  .control,
  .desc-input {
    width: 100%;
  }
}
</style>
