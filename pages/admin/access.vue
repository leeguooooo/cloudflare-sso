<template>
  <NuxtLayout name="default">
    <div class="dashboard-page">
      <div class="page-header">
        <div>
          <h2 class="page-title">{{ t('access.title') }}</h2>
          <p class="page-subtitle">{{ t('access.subtitle') }}</p>
        </div>
        <div class="header-controls">
          <UiInput v-model="tenantId" :placeholder="t('access.tenant')" class="control-input" />
          <UiInput v-model="clientId" :placeholder="t('access.client')" class="control-input" />
          <UiInput v-model="userId" :placeholder="t('access.user')" class="control-input" />
          <UiButton @click="loadSnapshot" :loading="loading">
            {{ t('access.load') }}
          </UiButton>
        </div>
      </div>

      <div class="dashboard-grid">
        <UiCard class="card">
          <template #header>
            <div class="card-header">
              <h3>{{ t('access.roles') }}</h3>
              <UiBadge variant="info" :label="String(roles.length)" />
            </div>
          </template>

          <div class="card-body">
            <div v-if="roles.length === 0" class="empty-state">
              No roles found.
            </div>
            <div v-else class="role-list">
              <div v-for="role in roles" :key="role.id" class="role-item">
                <div class="role-content">
                  <div class="role-header">
                    <strong>{{ role.name }}</strong>
                    <span class="role-id">ID: {{ role.id }}</span>
                  </div>
                  <p class="role-desc">{{ role.description }}</p>
                </div>
                <div class="role-perms">
                  <UiBadge v-for="perm in role.permissions" :key="perm" variant="neutral" :label="perm" />
                </div>
              </div>
            </div>
          </div>
        </UiCard>

        <UiCard class="card">
          <template #header>
            <div class="card-header">
              <h3>{{ t('access.permissions') }}</h3>
              <UiBadge variant="info" :label="String(permissions.length)" />
            </div>
          </template>

          <div class="card-body">
            <div class="perm-cloud">
              <UiBadge v-for="perm in permissions" :key="perm" variant="neutral" :label="perm" />
            </div>
          </div>
        </UiCard>
      </div>

      <div class="dashboard-grid">
        <UiCard class="card" :title="t('access.createRole')">
          <div class="card-body">
            <form @submit.prevent="createRole" class="action-form">
              <UiInput v-model="roleForm.name" :label="t('access.roleName')" required />
              <UiInput v-model="roleForm.description" :label="t('access.roleDesc')" />
              <UiTextarea
                v-model="roleForm.permissions"
                :label="t('access.rolePerms')"
                :rows="3"
                placeholder="read:users, write:users"
              />
              <UiInput v-model="roleForm.clientIds" :label="t('access.client') + ' (comma separated IDs)'" />
              <UiButton type="submit" :loading="loading" block>{{ t('access.saveRole') }}</UiButton>
            </form>
          </div>
        </UiCard>

        <UiCard class="card" :title="t('access.assign')">
          <div class="card-body">
            <form @submit.prevent="assignRole" class="action-form">
              <UiInput v-model="assign.userId" :label="t('access.user')" required />
              <UiInput v-model="assign.roleId" :label="t('access.roleName')" required />
              <UiInput v-model="assign.clientId" :label="t('access.client') + ' (optional)'" />
              <UiButton type="submit" :loading="loading" block>{{ t('access.assign') }}</UiButton>
            </form>

            <div class="divider"></div>

            <h4 class="sub-header">{{ t('access.bindRole') }}</h4>
            <form @submit.prevent="bindRole" class="action-form">
              <UiInput v-model="bind.clientId" :label="t('access.client')" required />
              <UiInput v-model="bind.roleId" :label="t('access.roleName')" required />
              <UiButton type="submit" :loading="loading" block>{{ t('access.bindRole') }}</UiButton>
            </form>
          </div>
        </UiCard>
      </div>

      <UiAlert
        v-if="message"
        class="toast"
        :variant="message.includes('Failed') ? 'danger' : 'success'"
        :message="message"
      />
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
const { t } = useI18n()
const config = useRuntimeConfig()

const tenantId = ref('tenant-demo')
const clientId = ref('demo-web')
const userId = ref('user-demo')

const roles = ref<{ id: string; name: string; description: string; permissions: string[] }[]>([])
const permissions = ref<string[]>([])
const loading = ref(false)
const message = ref('')

const roleForm = reactive({
  name: '',
  description: '',
  permissions: '',
  clientIds: '',
})

const assign = reactive({
  userId: '',
  roleId: '',
  clientId: '',
})

const bind = reactive({
  clientId: '',
  roleId: '',
})

const getAuthHeaders = () => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

const loadSnapshot = async () => {
  if (!tenantId.value) return
  loading.value = true
  message.value = ''
  try {
    const data = await $fetch(`${config.public.apiBase}/access/summary`, {
      method: 'GET',
      query: {
        tenant_id: tenantId.value,
        client_id: clientId.value,
        user_id: userId.value,
      },
      headers: getAuthHeaders(),
    })
    roles.value = (data as any).roles || []
    permissions.value = (data as any).permissions || []
    message.value = t('access.success')
  } catch (err: any) {
    message.value = err?.data?.message || err?.message || 'Failed to load'
  } finally {
    loading.value = false
  }
}

const createRole = async () => {
  if (!tenantId.value || !roleForm.name) return
  loading.value = true
  message.value = ''
  try {
    const perms = roleForm.permissions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const clientIds = roleForm.clientIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await $fetch(`${config.public.apiBase}/access/role`, {
      method: 'POST',
      body: {
        tenant_id: tenantId.value,
        name: roleForm.name,
        description: roleForm.description,
        permissions: perms,
        client_ids: clientIds,
      },
      headers: getAuthHeaders(),
    })
    message.value = t('access.success')
    roleForm.name = ''
    roleForm.description = ''
    roleForm.permissions = ''
    roleForm.clientIds = ''
    await loadSnapshot()
  } catch (err: any) {
    message.value = err?.data?.message || err?.message || 'Failed to save role'
  } finally {
    loading.value = false
  }
}

const assignRole = async () => {
  loading.value = true
  message.value = ''
  try {
    await $fetch(`${config.public.apiBase}/access/assign`, {
      method: 'POST',
      body: {
        user_id: assign.userId,
        role_id: assign.roleId,
        client_id: assign.clientId || undefined,
      },
      headers: getAuthHeaders(),
    })
    message.value = t('access.success')
    await loadSnapshot()
  } catch (err: any) {
    message.value = err?.data?.message || err?.message || 'Failed to assign'
  } finally {
    loading.value = false
  }
}

const bindRole = async () => {
  loading.value = true
  message.value = ''
  try {
    await $fetch(`${config.public.apiBase}/access/client-role`, {
      method: 'POST',
      body: {
        client_id: bind.clientId,
        role_id: bind.roleId,
      },
      headers: getAuthHeaders(),
    })
    message.value = t('access.success')
    await loadSnapshot()
  } catch (err: any) {
    message.value = err?.data?.message || err?.message || 'Failed to bind role'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
  loadSnapshot()
})
</script>

<style scoped>
.dashboard-page {
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
  gap: 12px;
  align-items: flex-end;
}

.control-input {
  width: 140px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 24px;
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

.role-list {
  display: flex;
  flex-direction: column;
}

.role-item {
  padding: 16px 0;
  border-bottom: 1px solid #f1f3f4;
}

.role-item:last-child {
  border-bottom: none;
}

.role-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.role-header strong {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1f1f1f;
}

.role-id {
  font-size: 0.75rem;
  color: #5f6368;
  font-family: 'Roboto Mono', monospace;
}

.role-desc {
  font-size: 0.875rem;
  color: #444746;
  margin-bottom: 12px;
}

.role-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.perm-tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  background-color: #f8f9fa;
  border: 1px solid #dadce0;
  border-radius: 4px;
  color: #444746;
}

.perm-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.divider {
  height: 1px;
  background-color: #dadce0;
  margin: 32px 0;
}

.sub-header {
  font-size: 1rem;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 16px;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: #5f6368;
  font-size: 0.875rem;
}

.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1000;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .header-controls {
    width: 100%;
  }

  .control-input {
    flex: 1;
  }
}
</style>
