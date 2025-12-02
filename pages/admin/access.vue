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
        <!-- Roles Section -->
        <section class="card">
          <div class="card-header">
            <h3>{{ t('access.roles') }}</h3>
            <span class="badge">{{ roles.length }}</span>
          </div>
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
                  <span v-for="perm in role.permissions" :key="perm" class="perm-tag">{{ perm }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Permissions Section -->
        <section class="card">
          <div class="card-header">
            <h3>{{ t('access.permissions') }}</h3>
            <span class="badge">{{ permissions.length }}</span>
          </div>
          <div class="card-body">
            <div class="perm-cloud">
              <span v-for="perm in permissions" :key="perm" class="perm-tag ghost">{{ perm }}</span>
            </div>
          </div>
        </section>
      </div>

      <div class="dashboard-grid">
        <!-- Create Role -->
        <section class="card">
          <div class="card-header">
            <h3>{{ t('access.createRole') }}</h3>
          </div>
          <div class="card-body">
            <form @submit.prevent="createRole" class="action-form">
              <UiInput v-model="roleForm.name" :label="t('access.roleName')" required />
              <UiInput v-model="roleForm.description" :label="t('access.roleDesc')" />
              <div class="form-group">
                <label class="form-label">{{ t('access.rolePerms') }}</label>
                <textarea v-model="roleForm.permissions" class="form-textarea" rows="3" placeholder="read:users, write:users"></textarea>
              </div>
              <UiInput v-model="roleForm.clientIds" :label="t('access.client') + ' (comma separated IDs)'" />
              <UiButton type="submit" :loading="loading" block>{{ t('access.saveRole') }}</UiButton>
            </form>
          </div>
        </section>

        <!-- Assignments -->
        <section class="card">
          <div class="card-header">
            <h3>{{ t('access.assign') }}</h3>
          </div>
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
        </section>
      </div>

      <div v-if="message" class="toast" :class="{ error: message.includes('Failed') }">
        {{ message }}
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
const { t } = useI18n()
const config = useRuntimeConfig()

const tenantId = ref('tenant-demo')
const clientId = ref('client-demo')
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
  roleName: '', // Added to match template usage if needed, though not used in original
})

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
  loadSnapshot()
})
</script>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.header-controls {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.control-input {
  width: 160px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

.card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
}

.card-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.badge {
  background-color: var(--color-primary-50);
  color: var(--color-primary-700);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.card-body {
  padding: 1.25rem;
  flex: 1;
}

.role-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.role-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem;
  background-color: var(--color-neutral-50);
}

.role-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.role-id {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  font-family: monospace;
}

.role-desc {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.role-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.perm-tag {
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
}

.perm-tag.ghost {
  background-color: var(--color-neutral-100);
}

.perm-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.action-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-textarea {
  width: 100%;
  padding: 0.625rem 0.875rem;
  font-size: var(--font-size-sm);
  line-height: 1.25rem;
  color: var(--color-text-primary);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  resize: vertical;
}

.form-textarea:focus {
  outline: none;
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

.divider {
  height: 1px;
  background-color: var(--color-border);
  margin: 1.5rem 0;
}

.sub-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 1rem;
}

.toast {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  padding: 1rem;
  background-color: var(--color-neutral-900);
  color: white;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  font-size: 0.875rem;
  z-index: 50;
  animation: slide-up 0.3s ease;
}

.toast.error {
  background-color: #ef4444;
}

@keyframes slide-up {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 768px) {
  .header-controls {
    width: 100%;
  }
  .control-input {
    width: 100%;
  }
}
</style>
