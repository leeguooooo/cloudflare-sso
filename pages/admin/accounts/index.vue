<template>
  <div class="accounts-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Accounts</h2>
        <p>Every person once, across all apps. Open an account to see its apps, sign-in methods, sessions and memberships.</p>
      </div>
      <form class="header-controls" @submit.prevent="load">
        <UiInput v-model="search" label="Search" placeholder="Email, name or account id" class="search-input" />
        <UiSelect v-model="status" label="Status" class="status-select">
          <option value="">Any</option>
          <option value="active">Active</option>
          <option value="disabled">Suspended</option>
        </UiSelect>
        <UiButton type="submit" variant="ghost" :loading="loading">Search</UiButton>
      </form>
    </div>

    <UiAlert v-if="error" variant="danger" :message="error" />

    <UiCard>
      <template #header>
        <div class="card-header">
          <h3>Accounts</h3>
          <UiBadge variant="info" :label="String(accounts.length)" />
        </div>
      </template>
      <UiTableShell :columns="columns" :rows="accounts" :empty-text="loading ? 'Loading…' : 'No accounts match.'">
        <template #cell="{ row, column }">
          <template v-if="column.key === 'email'">
            <NuxtLink :to="`/admin/accounts/${asAccount(row).id}`" class="account-link">
              <span class="font-medium">{{ asAccount(row).display_name || asAccount(row).email }}</span>
            </NuxtLink>
            <div class="text-xs muted">{{ asAccount(row).email }}</div>
          </template>
          <template v-else-if="column.key === 'status'">
            <UiBadge :variant="asAccount(row).status === 'active' ? 'success' : 'danger'" :label="statusLabel(asAccount(row).status)" />
          </template>
          <template v-else-if="column.key === 'tenants'">
            <div class="badge-row">
              <UiBadge v-for="tenant in asAccount(row).tenants" :key="tenant" variant="neutral" :label="tenant" />
              <span v-if="!asAccount(row).tenants.length" class="text-xs muted">—</span>
            </div>
          </template>
          <template v-else-if="column.key === 'providers'">
            <span class="text-xs">{{ asAccount(row).providers.join(', ') || 'password' }}</span>
          </template>
          <template v-else-if="column.key === 'last_sign_in_at'">
            <span class="text-xs">{{ formatAdminTime(asAccount(row).last_sign_in_at) }}</span>
          </template>
          <template v-else-if="column.key === 'created_at'">
            <span class="text-xs">{{ formatAdminTime(asAccount(row).created_at) }}</span>
          </template>
        </template>
      </UiTableShell>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
type AdminAccount = {
  id: string
  email: string
  display_name: string | null
  status: string
  created_at: number
  tenants: string[]
  providers: string[]
  last_sign_in_at: number | null
}

const route = useRoute()
const router = useRouter()
const { get, errorText, signedIn } = useAdminApi()
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const status = ref(typeof route.query.status === 'string' ? route.query.status : '')
const accounts = ref<AdminAccount[]>([])
const loading = ref(false)
const error = ref('')

const columns = [
  { key: 'email', label: 'Account' },
  { key: 'status', label: 'Status' },
  { key: 'tenants', label: 'Apps (tenants)' },
  { key: 'providers', label: 'Sign-in methods' },
  { key: 'last_sign_in_at', label: 'Last sign-in' },
  { key: 'created_at', label: 'Created' },
]

const asAccount = (row: Record<string, unknown>) => row as unknown as AdminAccount
const statusLabel = (value: string) => (value === 'disabled' ? 'suspended' : value)

const load = async () => {
  loading.value = true
  error.value = ''
  void router.replace({ query: { q: search.value.trim() || undefined, status: status.value || undefined } })
  try {
    const data = await get<{ accounts: AdminAccount[] }>('/admin/accounts', {
      q: search.value.trim() || undefined,
      status: status.value || undefined,
      limit: 100,
    })
    accounts.value = data.accounts || []
  } catch (err) {
    error.value = errorText(err, 'Failed to load accounts')
  } finally {
    loading.value = false
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
.accounts-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
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
  max-width: 560px;
}

.header-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.search-input {
  width: 260px;
}

.status-select {
  width: 140px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.card-header h3 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0;
}

.account-link {
  color: #1a73e8;
  text-decoration: none;
}

.account-link:hover {
  text-decoration: underline;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-controls {
    flex-wrap: wrap;
  }

  .search-input,
  .status-select {
    width: 100%;
  }
}
</style>
