<template>
  <div class="account-detail">
    <NuxtLink to="/admin/accounts" class="back-link">← All accounts</NuxtLink>

    <UiAlert v-if="error" variant="danger" :message="error" />
    <UiAlert v-if="message" variant="success" :message="message" />

    <template v-if="data">
      <UiCard>
        <div class="profile">
          <div class="avatar">
            <img v-if="data.account.avatar_url" :src="data.account.avatar_url" alt="" />
            <span v-else>{{ initial }}</span>
          </div>
          <div class="profile-text">
            <h2>{{ data.account.display_name || data.account.email }}</h2>
            <div class="muted">{{ data.account.email }}</div>
            <div class="text-xs muted mono">{{ data.account.id }}</div>
            <div class="badge-row">
              <UiBadge :variant="data.account.status === 'active' ? 'success' : 'danger'" :label="data.account.status === 'disabled' ? 'suspended' : data.account.status" />
              <UiBadge variant="neutral" :label="data.account.password_set ? 'password set' : 'no password'" />
              <UiBadge variant="neutral" :label="`locale ${data.account.locale || 'en'}`" />
            </div>
            <div class="text-xs muted">Created {{ formatAdminTime(data.account.created_at) }}</div>
          </div>
          <div class="profile-actions">
            <UiButton
              v-if="data.account.status === 'active'"
              variant="ghost"
              class="text-danger"
              :disabled="busy"
              @click="act('suspend', `Suspend ${data.account.email}? They are signed out of every app and cannot sign in until restored.`)"
            >
              Suspend
            </UiButton>
            <UiButton v-else variant="outline" :disabled="busy" @click="act('restore', `Restore ${data.account.email}?`)">Restore</UiButton>
            <UiButton
              variant="ghost"
              :disabled="busy || !activeSessions"
              @click="act('revoke_sessions', `Sign ${data.account.email} out of every app and device?`)"
            >
              Sign out everywhere ({{ activeSessions }})
            </UiButton>
          </div>
        </div>
      </UiCard>

      <div class="grid">
        <UiCard>
          <template #header><h3>Apps (tenant users)</h3></template>
          <UiTableShell :columns="userColumns" :rows="data.users" empty-text="Not signed in to any app yet.">
            <template #cell="{ row, column }">
              <template v-if="column.key === 'tenant'">
                <div class="font-medium">{{ row.tenant_name }}</div>
                <div class="text-xs muted mono">{{ row.tenant_id }}</div>
              </template>
              <template v-else-if="column.key === 'status'">
                <UiBadge :variant="row.status === 'active' ? 'success' : 'danger'" :label="String(row.status)" />
              </template>
              <template v-else-if="column.key === 'roles'">
                <span class="text-xs">{{ (row.roles as string[]).join(', ') || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'created_at'">
                <span class="text-xs">{{ formatAdminTime(row.created_at as number) }}</span>
              </template>
            </template>
          </UiTableShell>
        </UiCard>

        <UiCard>
          <template #header><h3>Sign-in methods</h3></template>
          <ul class="plain-list">
            <li v-if="data.account.password_set">
              <span class="font-medium">Password</span>
            </li>
            <li v-for="identity in data.identities" :key="identity.provider">
              <span class="font-medium">{{ identity.provider }}</span>
              <span class="text-xs muted">{{ identity.email || '—' }}</span>
              <UiBadge v-if="identity.is_private_email" variant="neutral" label="private relay" />
              <UiBadge v-if="identity.consent_revoked_at" variant="danger" label="consent revoked" />
              <span class="text-xs muted">since {{ formatAdminTime(identity.created_at) }}</span>
            </li>
            <li v-if="!data.account.password_set && !data.identities.length" class="muted">None</li>
          </ul>
        </UiCard>
      </div>

      <UiCard>
        <template #header>
          <div class="card-header">
            <h3>Memberships &amp; entitlements</h3>
          </div>
        </template>
        <form class="grant-form" @submit.prevent="grant">
          <UiSelect v-model="grantForm.tenant_id" label="App" class="grant-field" required>
            <option value="">Select app</option>
            <option v-for="tenant in grantTenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }} ({{ tenant.id }})</option>
          </UiSelect>
          <UiInput v-model="grantForm.entitlement_key" label="Entitlement key" placeholder="jrkan.premium" class="grant-field" required />
          <UiInput v-model="grantForm.days" label="Days (empty = no end)" type="number" class="grant-days" />
          <UiInput v-model="grantForm.note" label="Note" placeholder="support ticket #" class="grant-field" />
          <UiButton type="submit" :disabled="busy">Grant</UiButton>
        </form>
        <UiTableShell :columns="entitlementColumns" :rows="data.entitlements" empty-text="No entitlements.">
          <template #cell="{ row, column }">
            <template v-if="column.key === 'key'">
              <span class="font-medium mono">{{ row.entitlement_key }}</span>
              <div class="text-xs muted">{{ row.tenant_id }}</div>
            </template>
            <template v-else-if="column.key === 'source'">
              <span class="text-xs">{{ row.trial ? 'trial' : row.source }}{{ row.provider ? ` · ${row.provider}` : '' }}</span>
            </template>
            <template v-else-if="column.key === 'state'">
              <UiBadge :variant="row.active ? 'success' : 'neutral'" :label="row.active ? 'active' : String(row.status === 'revoked' ? 'revoked' : 'ended')" />
            </template>
            <template v-else-if="column.key === 'window'">
              <span class="text-xs">{{ formatAdminTime(row.valid_from as number) }} → {{ row.valid_to ? formatAdminTime(row.valid_to as number) : 'no end' }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <UiButton
                v-if="row.source === 'manual' && row.active"
                variant="ghost"
                size="sm"
                class="text-danger"
                :disabled="busy"
                @click="revokeEntitlement(row.tenant_id as string, row.entitlement_key as string)"
              >
                Revoke
              </UiButton>
            </template>
          </template>
        </UiTableShell>
        <div v-if="data.subscriptions.length" class="subs">
          <h4>Subscriptions</h4>
          <ul class="plain-list">
            <li v-for="sub in data.subscriptions" :key="sub.id">
              <span class="font-medium mono">{{ sub.plan_key || '—' }}</span>
              <UiBadge variant="neutral" :label="sub.status" />
              <span class="text-xs muted">{{ sub.tenant_id }} · {{ sub.provider }} · period end {{ formatAdminTime(sub.current_period_end) }}{{ sub.cancel_at_period_end ? ' · cancels' : '' }}</span>
            </li>
          </ul>
        </div>
      </UiCard>

      <UiCard>
        <template #header><h3>Sessions</h3></template>
        <UiTableShell :columns="sessionColumns" :rows="data.sessions" empty-text="No sessions.">
          <template #cell="{ row, column }">
            <template v-if="column.key === 'client'">
              <span class="font-medium">{{ row.client_name || row.client_id || '—' }}</span>
              <div class="text-xs muted">{{ row.tenant_id }}</div>
            </template>
            <template v-else-if="column.key === 'device'">
              <span class="text-xs">{{ row.ip || '—' }}</span>
              <div class="text-xs muted ua">{{ row.user_agent || '' }}</div>
            </template>
            <template v-else-if="column.key === 'when'">
              <span class="text-xs">{{ formatAdminTime(row.created_at as number) }}</span>
              <div class="text-xs muted">last refresh {{ formatAdminTime(row.rotated_at as number) }}</div>
            </template>
            <template v-else-if="column.key === 'state'">
              <UiBadge :variant="row.active ? 'success' : 'neutral'" :label="row.active ? 'active' : row.revoked_at ? 'revoked' : 'expired'" />
            </template>
          </template>
        </UiTableShell>
      </UiCard>

      <UiCard>
        <template #header>
          <div class="card-header">
            <h3>Recent activity</h3>
            <NuxtLink :to="`/admin/audit?account=${data.account.id}`" class="text-xs account-link">Full audit log</NuxtLink>
          </div>
        </template>
        <ul class="plain-list">
          <li v-for="entry in data.audit" :key="entry.id">
            <span class="mono font-medium">{{ entry.action }}</span>
            <span class="text-xs muted">{{ entry.tenant_id }} · {{ entry.ip || '—' }} · {{ formatAdminTime(entry.created_at) }}</span>
          </li>
          <li v-if="!data.audit.length" class="muted">No activity recorded.</li>
        </ul>
      </UiCard>
    </template>
    <div v-else-if="loading" class="muted">Loading…</div>
  </div>
</template>

<script setup lang="ts">
type Row = Record<string, unknown>
type Detail = {
  account: { id: string; email: string; display_name: string | null; avatar_url: string | null; locale: string | null; status: string; password_set: boolean; created_at: number }
  users: Row[]
  identities: { provider: string; email: string | null; is_private_email: boolean; consent_revoked_at: number | null; created_at: number }[]
  sessions: Row[]
  entitlements: Row[]
  subscriptions: { id: string; tenant_id: string; plan_key: string | null; provider: string; status: string; current_period_end: number | null; cancel_at_period_end: boolean }[]
  audit: { id: string; tenant_id: string | null; action: string; ip: string | null; created_at: number }[]
}

const route = useRoute()
const { get, post, errorText, signedIn } = useAdminApi()
const { state: tenants, load: loadTenants } = useAdminTenants()
const id = computed(() => String(route.params.id || ''))
const data = ref<Detail | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const grantForm = reactive({ tenant_id: '', entitlement_key: '', days: '', note: '' })

const userColumns = [
  { key: 'tenant', label: 'App' },
  { key: 'status', label: 'Status' },
  { key: 'roles', label: 'Roles' },
  { key: 'created_at', label: 'Joined' },
]
const entitlementColumns = [
  { key: 'key', label: 'Entitlement' },
  { key: 'source', label: 'Source' },
  { key: 'state', label: 'State' },
  { key: 'window', label: 'Valid' },
  { key: 'actions', label: '' },
]
const sessionColumns = [
  { key: 'client', label: 'App' },
  { key: 'device', label: 'Device' },
  { key: 'when', label: 'Signed in' },
  { key: 'state', label: 'State' },
]

const initial = computed(() => (data.value?.account.display_name || data.value?.account.email || '?').slice(0, 1).toUpperCase())
const activeSessions = computed(() => (data.value?.sessions || []).filter((s) => s.active).length)
// Grants can target any tenant; the account's own apps come first.
const grantTenants = computed(() => {
  const mine = new Set((data.value?.users || []).map((u) => String(u.tenant_id)))
  return [...tenants.value.tenants].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))
})

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    data.value = await get<Detail>(`/admin/accounts/${encodeURIComponent(id.value)}`)
  } catch (err) {
    error.value = errorText(err, 'Failed to load account')
  } finally {
    loading.value = false
  }
}

const run = async (body: Record<string, unknown>, done: string) => {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await post(`/admin/accounts/${encodeURIComponent(id.value)}`, body)
    message.value = done
    await load()
    return true
  } catch (err) {
    error.value = errorText(err, 'Action failed')
    return false
  } finally {
    busy.value = false
  }
}

const DONE: Record<string, string> = { suspend: 'Account suspended', restore: 'Account restored', revoke_sessions: 'Signed out everywhere' }

const act = (action: 'suspend' | 'restore' | 'revoke_sessions', confirmText: string) => {
  if (!process.client || !window.confirm(confirmText)) return
  void run({ action }, DONE[action])
}

const grant = async () => {
  const days = Number(grantForm.days)
  const validTo = grantForm.days && days > 0 ? Math.floor(Date.now() / 1000) + Math.floor(days * 86400) : null
  const ok = await run(
    { action: 'grant_entitlement', tenant_id: grantForm.tenant_id, entitlement_key: grantForm.entitlement_key.trim(), valid_to: validTo, note: grantForm.note.trim() || undefined },
    `Granted ${grantForm.entitlement_key.trim()}`,
  )
  if (ok) Object.assign(grantForm, { entitlement_key: '', days: '', note: '' })
}

const revokeEntitlement = (tenantId: string, key: string) => {
  if (!process.client || !window.confirm(`Revoke the manual grant of ${key} in ${tenantId}?`)) return
  void run({ action: 'revoke_entitlement', tenant_id: tenantId, entitlement_key: key }, `Revoked ${key}`)
}

onMounted(() => {
  if (!signedIn()) {
    navigateTo('/login')
    return
  }
  void load()
  void loadTenants().catch(() => {})
})
</script>

<style scoped>
.account-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.back-link,
.account-link {
  color: #1a73e8;
  text-decoration: none;
  font-size: 0.875rem;
}

.profile {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #e8f0fe;
  color: #1a73e8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-text {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-text h2 {
  font-size: 1.375rem;
  font-weight: 400;
  margin: 0;
  color: #1f1f1f;
}

.profile-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

h3 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0;
}

h4 {
  font-size: 0.875rem;
  font-weight: 500;
  margin: 16px 0 8px;
}

.plain-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.plain-list li {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.grant-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.grant-field {
  width: 200px;
}

.grant-days {
  width: 140px;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0;
}

.ua {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }
.text-danger { color: #d93025; }

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .grant-field,
  .grant-days {
    width: 100%;
  }
}
</style>
