<template>
  <div class="users-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Users</h2>
        <p>Find users in a tenant, disable or re-enable them, and sign them out everywhere.</p>
      </div>
      <form class="header-controls" @submit.prevent="loadUsers">
        <UiInput v-model="tenantId" label="Tenant ID" class="control-input" />
        <UiInput v-model="search" label="Search email" placeholder="name@example.com" class="search-input" />
        <UiButton type="submit" variant="ghost" :loading="loading">Search</UiButton>
      </form>
    </div>

    <UiCard class="info-card">
      <template #header>
        <div class="card-header">
          <h3>Users</h3>
          <UiBadge variant="info" :label="String(users.length)" />
        </div>
      </template>

      <UiAlert v-if="error" variant="danger" :message="error" class="error-alert" />
      <UiAlert v-if="message" variant="success" :message="message" class="error-alert" />

      <UiTableShell :columns="columns" :rows="users" empty-text="No users match this search.">
        <template #cell="{ row, column }">
          <template v-if="column.key === 'email'">
            <span class="font-medium">{{ asUser(row).email }}</span>
            <div class="text-xs muted">{{ asUser(row).id }}</div>
          </template>
          <template v-else-if="column.key === 'status'">
            <UiBadge :variant="asUser(row).status === 'active' ? 'success' : 'danger'" :label="asUser(row).status" />
          </template>
          <template v-else-if="column.key === 'roles'">
            <div class="badge-row">
              <UiBadge v-for="role in asUser(row).roles" :key="role" variant="neutral" :label="role" />
              <span v-if="!asUser(row).roles.length" class="text-xs muted">—</span>
            </div>
          </template>
          <template v-else-if="column.key === 'last_sign_in_at'">
            <span class="text-xs">{{ formatTime(asUser(row).last_sign_in_at) }}</span>
          </template>
          <template v-else-if="column.key === 'active_sessions'">
            <span>{{ asUser(row).active_sessions }}</span>
          </template>
          <template v-else-if="column.key === 'created_at'">
            <span class="text-xs">{{ formatTime(asUser(row).created_at) }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <div class="table-actions">
              <UiButton
                v-if="asUser(row).status === 'active'"
                variant="ghost"
                size="sm"
                class="text-danger"
                :disabled="busyId === asUser(row).id"
                @click="act(asUser(row), 'disable')"
              >
                Disable
              </UiButton>
              <UiButton
                v-else
                variant="outline"
                size="sm"
                :disabled="busyId === asUser(row).id"
                @click="act(asUser(row), 'enable')"
              >
                Enable
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :disabled="busyId === asUser(row).id || !asUser(row).active_sessions"
                @click="act(asUser(row), 'revoke_sessions')"
              >
                Sign out everywhere
              </UiButton>
            </div>
          </template>
        </template>
      </UiTableShell>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
import { storedTokenTenantId } from '~/utils/token-claims'

type AdminUser = {
  id: string
  email: string
  status: string
  global_account_id: string | null
  created_at: number
  roles: string[]
  last_sign_in_at: number | null
  active_sessions: number
}

type UserAction = 'disable' | 'enable' | 'revoke_sessions'

const config = useRuntimeConfig()
const tenantId = ref('')
const search = ref('')
const users = ref<AdminUser[]>([])
const loading = ref(false)
const busyId = ref('')
const error = ref('')
const message = ref('')

const columns = [
  { key: 'email', label: 'User' },
  { key: 'status', label: 'Status' },
  { key: 'roles', label: 'Roles' },
  { key: 'last_sign_in_at', label: 'Last sign-in' },
  { key: 'active_sessions', label: 'Sessions' },
  { key: 'created_at', label: 'Created' },
  { key: 'actions', label: 'Actions' },
]

const asUser = (row: Record<string, unknown>) => row as unknown as AdminUser

const formatTime = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toLocaleString() : '—'

const getAuthHeaders = () => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token')
  if (!token) {
    navigateTo('/login')
    return {}
  }
  return { authorization: `Bearer ${token}` }
}

const errorText = (err: any, fallback: string) =>
  err?.data?.statusMessage || err?.data?.message || err?.message || fallback

const loadUsers = async () => {
  if (!tenantId.value.trim()) return
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{ users: AdminUser[] }>(`${config.public.apiBase}/admin/users`, {
      query: { tenant_id: tenantId.value.trim(), q: search.value.trim() || undefined, limit: 50 },
      headers: getAuthHeaders(),
    })
    users.value = data.users || []
  } catch (err: any) {
    error.value = errorText(err, 'Failed to load users')
  } finally {
    loading.value = false
  }
}

const CONFIRM: Record<UserAction, (email: string) => string> = {
  disable: (email) => `Disable ${email}? They are signed out everywhere and cannot sign in or refresh tokens until re-enabled.`,
  enable: (email) => `Re-enable ${email}?`,
  revoke_sessions: (email) => `Sign ${email} out of every device and app?`,
}

const DONE: Record<UserAction, string> = {
  disable: 'User disabled',
  enable: 'User enabled',
  revoke_sessions: 'All sessions revoked',
}

const act = async (user: AdminUser, action: UserAction) => {
  if (!process.client || !window.confirm(CONFIRM[action](user.email))) return
  busyId.value = user.id
  error.value = ''
  message.value = ''
  try {
    await $fetch(`${config.public.apiBase}/admin/users`, {
      method: 'POST',
      body: { tenant_id: tenantId.value.trim(), action, user_id: user.id },
      headers: getAuthHeaders(),
    })
    message.value = `${DONE[action]}: ${user.email}`
    await loadUsers()
  } catch (err: any) {
    error.value = errorText(err, 'Action failed')
  } finally {
    busyId.value = ''
  }
}

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
  tenantId.value = storedTokenTenantId()
  void loadUsers()
})
</script>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
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
  align-items: flex-end;
}

.control-input {
  width: 160px;
}

.search-input {
  width: 220px;
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

.error-alert {
  margin-bottom: 12px;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }
.text-danger { color: #d93025; }

.table-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-controls {
    flex-wrap: wrap;
  }

  .control-input,
  .search-input {
    width: 100%;
  }
}
</style>
