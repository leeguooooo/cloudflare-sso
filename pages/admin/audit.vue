<template>
  <div class="audit-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Audit log</h2>
        <p>Sign-ins, account changes and every admin action, newest first.</p>
      </div>
      <form class="header-controls" @submit.prevent="reload">
        <AdminTenantPicker v-model="tenantId" allow-all class="control" @change="reload" />
        <UiInput v-model="action" label="Action prefix" placeholder="admin. / auth.login" class="control" />
        <UiInput v-model="account" label="Account id" placeholder="global account id" class="control" />
        <UiButton type="submit" variant="ghost" :loading="loading">Filter</UiButton>
      </form>
    </div>

    <UiAlert v-if="error" variant="danger" :message="error" />

    <UiCard>
      <UiTableShell :columns="columns" :rows="entries" :empty-text="loading ? 'Loading…' : 'No entries.'">
        <template #cell="{ row, column }">
          <template v-if="column.key === 'created_at'">
            <span class="text-xs nowrap">{{ formatAdminTime(row.created_at as number) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <button type="button" class="link mono" @click="filterAction(String(row.action))">{{ row.action }}</button>
            <div class="text-xs muted">{{ row.tenant_id || '—' }}</div>
          </template>
          <template v-else-if="column.key === 'actor'">
            <span class="text-xs">{{ row.user_email || row.user_id || '—' }}</span>
            <div class="text-xs muted">{{ row.ip || '' }}</div>
          </template>
          <template v-else-if="column.key === 'payload'">
            <code class="payload">{{ formatPayload(row.payload) }}</code>
          </template>
        </template>
      </UiTableShell>
      <div v-if="nextBefore" class="more">
        <UiButton variant="ghost" :loading="loading" @click="loadMore">Load older</UiButton>
      </div>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
type Entry = Record<string, unknown>

const route = useRoute()
const router = useRouter()
const { get, errorText, signedIn } = useAdminApi()
const tenantId = ref('')
const action = ref(typeof route.query.action === 'string' ? route.query.action : '')
const account = ref(typeof route.query.account === 'string' ? route.query.account : '')
const entries = ref<Entry[]>([])
const nextBefore = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

const columns = [
  { key: 'created_at', label: 'When' },
  { key: 'action', label: 'Action' },
  { key: 'actor', label: 'User' },
  { key: 'payload', label: 'Details' },
]

const formatPayload = (payload: unknown) => {
  const text = JSON.stringify(payload ?? {})
  return text === '{}' ? '' : text.length > 240 ? `${text.slice(0, 240)}…` : text
}

const fetchPage = async (before: string | null) => {
  loading.value = true
  error.value = ''
  try {
    const data = await get<{ entries: Entry[]; next_before: string | null }>('/admin/audit', {
      tenant_id: tenantId.value || undefined,
      action: action.value.trim() || undefined,
      account: account.value.trim() || undefined,
      before: before || undefined,
      limit: 50,
    })
    entries.value = before ? [...entries.value, ...(data.entries || [])] : data.entries || []
    nextBefore.value = data.next_before
  } catch (err) {
    error.value = errorText(err, 'Failed to load audit log')
  } finally {
    loading.value = false
  }
}

const reload = () => {
  void router.replace({
    query: { ...route.query, action: action.value.trim() || undefined, account: account.value.trim() || undefined },
  })
  void fetchPage(null)
}

const loadMore = () => void fetchPage(nextBefore.value)

const filterAction = (value: string) => {
  action.value = value
  reload()
}

onMounted(() => {
  if (!signedIn()) {
    navigateTo('/login')
    return
  }
  void fetchPage(null)
})
</script>

<style scoped>
.audit-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
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
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.control {
  width: 200px;
}

.link {
  background: none;
  border: 0;
  padding: 0;
  color: #1a73e8;
  cursor: pointer;
  font-size: 0.8125rem;
  text-align: left;
}

.payload {
  font-size: 0.75rem;
  color: #3c4043;
  word-break: break-all;
}

.more {
  display: flex;
  justify-content: center;
  padding-top: 12px;
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }
.nowrap { white-space: nowrap; }

@media (max-width: 900px) {
  .control {
    width: 100%;
  }
}
</style>
