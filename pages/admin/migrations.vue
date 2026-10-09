<template>
  <div class="migrations-page">
    <div class="page-header">
      <div class="header-text">
        <h2>User migration</h2>
        <p>
          Map an app's existing users to SSO accounts. Only emails the old app verified are linked automatically; everything
          else comes back as "needs review". Always dry-run first.
        </p>
      </div>
      <div class="header-controls">
        <AdminTenantPicker v-model="tenantId" class="control" @change="loadMappings" />
        <UiInput v-model="sourceSystem" label="Source system" placeholder="paste" class="control" />
      </div>
    </div>

    <UiAlert v-if="error" variant="danger" :message="error" />
    <UiAlert v-if="message" variant="success" :message="message" />

    <UiCard>
      <template #header><h3>Import</h3></template>
      <p class="hint">
        One user per line: <code>source_user_id,email,email_verified</code> (<code>true</code>/<code>false</code>), or
        <code>source_user_id,,,global_account_id</code> to link by hand. At most 100 lines per run.
      </p>
      <UiTextarea v-model="csv" label="Users (CSV)" :rows="8" placeholder="1024,alice@example.com,true" />
      <div class="import-actions">
        <UiCheckbox v-model="createMissing" label="Create SSO accounts for verified emails that have none" />
        <div class="buttons">
          <UiButton variant="ghost" :loading="busy === 'dry'" :disabled="!!busy || !records.length" @click="run(true)">Dry run</UiButton>
          <UiButton :loading="busy === 'real'" :disabled="!!busy || !records.length || !dryRunDone" @click="run(false)">Import {{ records.length }}</UiButton>
        </div>
      </div>
      <p v-if="parseErrors.length" class="bad">{{ parseErrors.join(' · ') }}</p>

      <template v-if="report">
        <div class="summary">
          <UiBadge v-for="(count, outcome) in report.summary" :key="outcome" :variant="outcomeVariant(String(outcome))" :label="`${outcome} ${count}`" />
          <span class="muted text-xs">{{ report.dry_run ? 'dry run — nothing written' : `run ${report.run_id}` }}</span>
          <UiButton v-if="!report.dry_run" variant="ghost" size="sm" class="bad" :disabled="!!busy" @click="revert({ run_id: report.run_id })">Revert this run</UiButton>
        </div>
        <UiTableShell :columns="resultColumns" :rows="report.results" empty-text="">
          <template #cell="{ row, column }">
            <template v-if="column.key === 'outcome'">
              <UiBadge :variant="outcomeVariant(String(row.outcome))" :label="String(row.outcome)" />
            </template>
            <template v-else>
              <span class="mono text-xs">{{ row[column.key] || '' }}</span>
            </template>
          </template>
        </UiTableShell>
      </template>
    </UiCard>

    <UiCard>
      <template #header>
        <div class="card-header">
          <h3>Mappings</h3>
          <UiButton variant="ghost" size="sm" :loading="loading" @click="loadMappings">Refresh</UiButton>
        </div>
      </template>
      <UiTableShell :columns="mappingColumns" :rows="mappings" :empty-text="loading ? 'Loading…' : 'No mappings yet.'">
        <template #cell="{ row, column }">
          <template v-if="column.key === 'source'">
            <span class="mono text-xs">{{ row.source_system }}:{{ row.source_user_id }}</span>
          </template>
          <template v-else-if="column.key === 'account'">
            <span class="text-xs">{{ row.email || row.global_account_id }}</span>
            <div class="mono text-xs muted">sub {{ row.user_id }}</div>
          </template>
          <template v-else-if="column.key === 'state'">
            <UiBadge :variant="row.status === 'active' ? outcomeVariant(String(row.outcome)) : 'neutral'" :label="row.status === 'active' ? String(row.outcome) : 'reverted'" />
          </template>
          <template v-else-if="column.key === 'mapped_at'">
            <span class="text-xs">{{ formatAdminTime(row.mapped_at as number) }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <UiButton v-if="row.status === 'active'" variant="ghost" size="sm" class="bad" :disabled="!!busy" @click="revert({ mapping_id: row.id })">Revert</UiButton>
          </template>
        </template>
      </UiTableShell>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
type Result = { source_user_id: string; outcome: string; reason?: string; global_account_id?: string; user_id?: string }
type Report = { run_id: string; dry_run: boolean; summary: Record<string, number>; results: Result[] }

const { get, post, errorText, signedIn } = useAdminApi()
const tenantId = ref('')
const sourceSystem = ref('')
const csv = ref('')
const createMissing = ref(false)
const report = ref<Report | null>(null)
const dryRunDone = ref(false)
const mappings = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const busy = ref<'' | 'dry' | 'real' | 'revert'>('')
const error = ref('')
const message = ref('')

const resultColumns = [
  { key: 'source_user_id', label: 'Legacy id' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'reason', label: 'Why' },
  { key: 'user_id', label: 'New sub' },
]
const mappingColumns = [
  { key: 'source', label: 'Legacy user' },
  { key: 'account', label: 'SSO account' },
  { key: 'state', label: 'State' },
  { key: 'mapped_at', label: 'Mapped' },
  { key: 'actions', label: '' },
]

const parsed = computed(() => {
  const out: Array<Record<string, unknown>> = []
  const errors: string[] = []
  csv.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const [id = '', email = '', verified = '', account = ''] = line.split(',').map((cell) => cell.trim())
      if (!id) errors.push(`line ${index + 1}: missing id`)
      else if (account) out.push({ source_user_id: id, global_account_id: account })
      else out.push({ source_user_id: id, email, email_verified: verified.toLowerCase() === 'true' })
    })
  if (out.length > 100) errors.push('more than 100 lines')
  return { records: out, errors }
})
const records = computed(() => parsed.value.records)
const parseErrors = computed(() => parsed.value.errors)

// Any edit invalidates the dry run that the import button relies on.
watch([csv, createMissing, sourceSystem, tenantId], () => {
  dryRunDone.value = false
})

const outcomeVariant = (outcome: string) =>
  outcome === 'linked' || outcome === 'created' || outcome === 'manual' || outcome === 'unchanged' ? 'success' : outcome === 'needs_review' ? 'info' : 'danger'

const run = async (dryRun: boolean) => {
  if (!dryRun && !window.confirm(`Import ${records.value.length} users into ${tenantId.value}?`)) return
  busy.value = dryRun ? 'dry' : 'real'
  error.value = ''
  message.value = ''
  try {
    report.value = await post<Report>('/admin/identity-mappings/import', {
      tenant_id: tenantId.value,
      source_system: sourceSystem.value.trim(),
      records: records.value,
      create_missing: createMissing.value,
      dry_run: dryRun,
    })
    dryRunDone.value = dryRun
    if (!dryRun) {
      message.value = 'Imported'
      await loadMappings()
    }
  } catch (err) {
    error.value = errorText(err, 'Import failed')
  } finally {
    busy.value = ''
  }
}

const revert = async (target: { run_id?: string; mapping_id?: string }) => {
  if (!window.confirm(target.run_id ? 'Revert every mapping of this run?' : 'Revert this mapping?')) return
  busy.value = 'revert'
  error.value = ''
  try {
    const data = await post<{ reverted: number; created_accounts: string[] }>('/admin/identity-mappings/revert', { tenant_id: tenantId.value, ...target })
    message.value = `Reverted ${data.reverted}${data.created_accounts.length ? ` — review ${data.created_accounts.length} account(s) the run created` : ''}`
    await loadMappings()
  } catch (err) {
    error.value = errorText(err, 'Revert failed')
  } finally {
    busy.value = ''
  }
}

const loadMappings = async () => {
  if (!tenantId.value) return
  loading.value = true
  try {
    const data = await get<{ mappings: Record<string, unknown>[] }>('/admin/identity-mappings', {
      tenant_id: tenantId.value,
      source_system: sourceSystem.value.trim() || undefined,
      limit: 100,
    })
    mappings.value = data.mappings || []
  } catch (err) {
    error.value = errorText(err, 'Failed to load mappings')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!signedIn()) {
    navigateTo('/login')
    return
  }
  void loadMappings()
})
</script>

<style scoped>
.migrations-page {
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
  max-width: 620px;
}

.header-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.control {
  width: 220px;
}

h3 {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 0;
  color: #1f1f1f;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.import-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 12px 0;
}

.buttons {
  display: flex;
  gap: 8px;
}

.summary {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.text-xs { font-size: 0.75rem; }
.muted { color: #5f6368; }
.bad { color: #d93025; }

@media (max-width: 900px) {
  .control {
    width: 100%;
  }
}
</style>
