<template>
  <div class="tenant-picker">
    <UiSelect
      v-if="state.platform && state.tenants.length"
      :model-value="modelValue"
      :label="label"
      class="tenant-select"
      @update:model-value="onSelect"
    >
      <option v-if="allowAll" value="">All tenants</option>
      <option v-for="tenant in state.tenants" :key="tenant.id" :value="tenant.id">
        {{ tenant.name }} ({{ tenant.id }})
      </option>
    </UiSelect>
    <UiInput
      v-else
      :model-value="modelValue"
      :label="label"
      class="tenant-select"
      :disabled="state.loaded && !state.platform"
      @update:model-value="(value: string | number) => emit('update:modelValue', String(value))"
    />
  </div>
</template>

<script setup lang="ts">
import { storedTokenTenantId } from '~/utils/token-claims'

/**
 * Tenant chooser for admin pages. Platform admins get a dropdown of every tenant; tenant
 * admins see their own tenant, read-only. The choice is kept in `?tenant=` so links and
 * reloads keep it. `change` fires only on a user's choice, for the page to reload.
 */
const props = withDefaults(defineProps<{ modelValue: string; label?: string; allowAll?: boolean }>(), {
  label: 'Tenant',
  allowAll: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()

const route = useRoute()
const router = useRouter()
const { state, load } = useAdminTenants()

const onSelect = (value: string | number) => {
  const next = String(value)
  if (next === props.modelValue) return
  emit('update:modelValue', next)
  emit('change', next)
  void router.replace({ query: { ...route.query, tenant: next || undefined } })
}

onMounted(async () => {
  const fromQuery = typeof route.query.tenant === 'string' ? route.query.tenant : ''
  const initial = fromQuery || props.modelValue || (props.allowAll ? '' : storedTokenTenantId())
  // Runs before the parent's onMounted, so the page's first load already uses this tenant.
  if (initial !== props.modelValue) emit('update:modelValue', initial)
  try {
    await load()
  } catch {
    // Older deployments or a lost token: the free-text input still works.
  }
})
</script>

<style scoped>
.tenant-select {
  min-width: 220px;
}
</style>
