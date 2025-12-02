<template>
  <div class="page">
    <div class="header">
      <div>
        <p class="eyebrow">{{ t('landing.eyebrow') }}</p>
        <h1>{{ t('access.title') }}</h1>
        <p class="subtext">{{ t('access.subtitle') }}</p>
      </div>
      <div class="inputs">
        <input v-model="tenantId" :placeholder="t('access.tenant')" />
        <input v-model="clientId" :placeholder="t('access.client')" />
        <input v-model="userId" :placeholder="t('access.user')" />
        <button class="btn" @click="loadSnapshot" :disabled="loading">{{ loading ? t('common.loading') : t('access.load') }}</button>
      </div>
    </div>

    <div class="grid">
      <section class="card">
        <div class="card-header">
          <h2>{{ t('access.roles') }}</h2>
          <span class="badge">{{ roles.length }}</span>
        </div>
        <div class="role-list">
          <div v-for="role in roles" :key="role.id" class="role-item">
            <div>
              <strong>{{ role.name }}</strong>
              <p>{{ role.description }}</p>
            </div>
            <div class="tags">
              <span v-for="perm in role.permissions" :key="perm" class="tag">{{ perm }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>{{ t('access.permissions') }}</h2>
          <span class="badge">{{ permissions.length }}</span>
        </div>
        <div class="tags">
          <span v-for="perm in permissions" :key="perm" class="tag ghost">{{ perm }}</span>
        </div>
      </section>
    </div>

    <div class="grid">
      <section class="card">
        <div class="card-header">
          <h2>{{ t('access.createRole') }}</h2>
        </div>
        <form class="form" @submit.prevent="createRole">
          <input v-model="roleForm.name" :placeholder="t('access.roleName')" required />
          <input v-model="roleForm.description" :placeholder="t('access.roleDesc')" />
          <textarea v-model="roleForm.permissions" :placeholder="t('access.rolePerms')" rows="3" />
          <input v-model="roleForm.clientIds" :placeholder="t('access.client') + ' (comma separated IDs)'" />
          <button class="btn" type="submit" :disabled="loading">{{ loading ? t('common.loading') : t('access.saveRole') }}</button>
        </form>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>{{ t('access.assign') }}</h2>
        </div>
        <form class="form" @submit.prevent="assignRole">
          <input v-model="assign.userId" :placeholder="t('access.user')" required />
          <input v-model="assign.roleId" :placeholder="t('access.roleName')" required />
          <input v-model="assign.clientId" :placeholder="t('access.client') + ' (optional)'" />
          <button class="btn" type="submit" :disabled="loading">{{ loading ? t('common.loading') : t('access.assign') }}</button>
        </form>
        <div class="card-header mt">
          <h2>{{ t('access.bindRole') }}</h2>
        </div>
        <form class="form" @submit.prevent="bindRole">
          <input v-model="bind.clientId" :placeholder="t('access.client')" required />
          <input v-model="bind.roleId" :placeholder="t('access.roleName')" required />
          <button class="btn" type="submit" :disabled="loading">{{ loading ? t('common.loading') : t('access.bindRole') }}</button>
        </form>
      </section>
    </div>

    <div v-if="message" class="toast">{{ message }}</div>
  </div>
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
.page {
  min-height: 100vh;
  padding: clamp(1.5rem, 3vw, 3rem);
  background: radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.18), transparent 30%),
    radial-gradient(circle at 80% 10%, rgba(14, 165, 233, 0.15), transparent 30%),
    linear-gradient(135deg, #05060a, #0a1020 60%, #05070d);
  color: #e5e7eb;
  display: grid;
  gap: 1.5rem;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.eyebrow {
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-size: 0.82rem;
  color: #c7d2fe;
}

h1 {
  margin: 0.1rem 0;
  font-size: clamp(1.9rem, 3vw, 2.6rem);
}

.subtext {
  margin: 0;
  color: #cbd5e1;
  line-height: 1.6;
}

.inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.inputs input {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  min-width: 180px;
}

.btn {
  padding: 0.95rem 1.2rem;
  border-radius: 12px;
  border: none;
  background: linear-gradient(120deg, #6366f1, #0ea5e9);
  color: #0b1020;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 1.25rem;
  display: grid;
  gap: 0.75rem;
  box-shadow: 0 15px 45px rgba(0, 0, 0, 0.25);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.card-header h2 {
  margin: 0;
}

.badge {
  padding: 0.35rem 0.65rem;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.5);
  color: #c7d2fe;
  font-weight: 700;
}

.role-list {
  display: grid;
  gap: 0.75rem;
}

.role-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.role-item p {
  margin: 0.15rem 0 0;
  color: #cbd5e1;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.tag {
  padding: 0.35rem 0.65rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e5e7eb;
  font-size: 0.9rem;
}

.tag.ghost {
  background: rgba(255, 255, 255, 0.04);
}

.form {
  display: grid;
  gap: 0.75rem;
}

.form input,
.form textarea {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  outline: none;
}

.toast {
  position: fixed;
  bottom: 16px;
  right: 16px;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(52, 211, 153, 0.4);
  color: #bbf7d0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}

.mt {
  margin-top: 0.5rem;
}

@media (max-width: 720px) {
  .inputs {
    flex-direction: column;
  }
  .inputs input,
  .inputs .btn {
    width: 100%;
  }
}
</style>
