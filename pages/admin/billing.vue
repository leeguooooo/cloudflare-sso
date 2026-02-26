<template>
  <div class="billing-page">
    <div class="page-header">
      <div class="header-text">
        <h2>Billing & Subscriptions</h2>
        <p>Manage product catalog, pricing plans, and entitlement configurations.</p>
      </div>
      <div class="header-controls">
        <UiInput v-model="tenantId" label="Tenant ID" class="control-input" />
        <UiCheckbox v-model="includeArchived" label="Show archived" class="checkbox-control" />
        <UiButton variant="ghost" @click="loadCatalog" :loading="loading">
          Refresh
        </UiButton>
      </div>
    </div>

    <UiAlert v-if="error" variant="danger" :message="error" class="error-alert" />

    <div class="admin-grid">
      <UiCard class="info-card" title="Create Product" subtitle="Define a new product entity that can contain multiple pricing plans.">
        <form @submit.prevent="createProductAction" class="admin-form">
          <div class="form-grid">
            <UiInput v-model="createProduct.product_key" label="Product Key" placeholder="blog-premium" required />
            <UiInput v-model="createProduct.name" label="Name" placeholder="Blog Premium" required />
            <UiInput v-model="createProduct.app_key" label="App Key" placeholder="blog | paste | cherry" required />
          </div>
          <div class="form-actions">
            <UiButton type="submit" variant="primary" :loading="loading">Create Product</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard class="info-card" title="Create Plan" subtitle="Define pricing, billing cycle, and entitlements for an existing product.">
        <form @submit.prevent="createPlanAction" class="admin-form">
          <div class="form-grid">
            <UiSelect v-model="createPlan.product_id" class="form-select" label="Product" required>
              <option value="">Select product</option>
              <option v-for="product in products" :key="product.id" :value="product.id">
                {{ product.product_key }} ({{ product.name }})
              </option>
            </UiSelect>
            <UiInput v-model="createPlan.plan_key" label="Plan Key" placeholder="paste-monthly" required />
            <UiInput v-model="createPlan.name" label="Name" placeholder="Paste Monthly" required />
            <UiSelect v-model="createPlan.billing_cycle" class="form-select" label="Billing Cycle">
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="one_time">One-time</option>
              <option value="custom">Custom</option>
            </UiSelect>
            <UiInput v-model="createPlan.currency" label="Currency" placeholder="USD" required />
            <UiInput v-model.number="createPlan.amount_minor" label="Amount (minor)" type="number" required />
            <UiInput v-model.number="createPlan.trial_days" label="Trial Days" type="number" />
            <UiInput v-model="createPlan.entitlement_keys" label="Entitlement Keys" placeholder="blog.read.premium, paste.pro" />
          </div>
          <div class="form-actions">
            <UiButton type="submit" variant="primary" :loading="loading">Create Plan</UiButton>
          </div>
        </form>
      </UiCard>

      <UiCard class="info-card wide-card">
        <template #header>
          <div class="card-header">
            <h3>Products</h3>
            <UiBadge variant="info" :label="String(products.length)" />
          </div>
        </template>

        <UiTableShell
          :columns="productColumns"
          :rows="products"
          empty-text="No products found."
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'product_key'">
              <UiInput v-if="editingProductId === asProduct(row).id" v-model="editProduct.product_key" class="table-input" />
              <span v-else class="font-medium">{{ asProduct(row).product_key }}</span>
            </template>
            <template v-else-if="column.key === 'name'">
              <UiInput v-if="editingProductId === asProduct(row).id" v-model="editProduct.name" class="table-input" />
              <span v-else>{{ asProduct(row).name }}</span>
            </template>
            <template v-else-if="column.key === 'app_key'">
              <UiInput v-if="editingProductId === asProduct(row).id" v-model="editProduct.app_key" class="table-input" />
              <span v-else>{{ asProduct(row).app_key }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <UiBadge :variant="statusBadgeVariant(asProduct(row).status)" :label="asProduct(row).status" />
            </template>
            <template v-else-if="column.key === 'actions'">
              <div class="table-actions">
                <template v-if="editingProductId === asProduct(row).id">
                  <UiButton variant="primary" size="sm" @click="saveProductEdit(asProduct(row).id)" :loading="loading">Save</UiButton>
                  <UiButton variant="ghost" size="sm" @click="cancelProductEdit" :disabled="loading">Cancel</UiButton>
                </template>
                <template v-else>
                  <UiButton variant="ghost" size="sm" @click="startProductEdit(asProduct(row))" :disabled="loading">Edit</UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    @click="toggleProductStatus(asProduct(row))"
                    :disabled="loading"
                    :class="{ 'text-danger': asProduct(row).status === 'active' }"
                  >
                    {{ asProduct(row).status === 'active' ? 'Archive' : 'Unarchive' }}
                  </UiButton>
                </template>
              </div>
            </template>
          </template>
        </UiTableShell>
      </UiCard>

      <UiCard class="info-card wide-card">
        <template #header>
          <div class="card-header">
            <h3>Plans</h3>
            <UiBadge variant="info" :label="String(plans.length)" />
          </div>
        </template>

        <UiTableShell
          :columns="planColumns"
          :rows="plans"
          empty-text="No plans found."
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'plan_key'">
              <UiInput v-if="editingPlanId === asPlan(row).id" v-model="editPlan.plan_key" class="table-input" />
              <span v-else class="font-medium">{{ asPlan(row).plan_key }}</span>
            </template>
            <template v-else-if="column.key === 'product_id'">
              <UiSelect v-if="editingPlanId === asPlan(row).id" v-model="editPlan.product_id" class="table-input">
                <option v-for="product in products" :key="product.id" :value="product.id">
                  {{ product.product_key }}
                </option>
              </UiSelect>
              <span v-else>{{ productKeyById(asPlan(row).product_id) }}</span>
            </template>
            <template v-else-if="column.key === 'billing_cycle'">
              <UiSelect v-if="editingPlanId === asPlan(row).id" v-model="editPlan.billing_cycle" class="table-input">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
                <option value="custom">Custom</option>
              </UiSelect>
              <span v-else>{{ asPlan(row).billing_cycle }}</span>
            </template>
            <template v-else-if="column.key === 'price'">
              <div v-if="editingPlanId === asPlan(row).id" class="inline-fields">
                <UiInput v-model="editPlan.currency" class="xs-input" />
                <UiInput v-model.number="editPlan.amount_minor" type="number" class="sm-input" />
              </div>
              <span v-else>{{ asPlan(row).currency }} {{ (asPlan(row).amount_minor / 100).toFixed(2) }}</span>
            </template>
            <template v-else-if="column.key === 'entitlements'">
              <UiInput v-if="editingPlanId === asPlan(row).id" v-model="editPlan.entitlement_keys" class="table-input" />
              <span v-else class="text-xs">{{ asPlan(row).entitlement_keys.join(', ') }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <UiBadge :variant="statusBadgeVariant(asPlan(row).status)" :label="asPlan(row).status" />
            </template>
            <template v-else-if="column.key === 'actions'">
              <div class="table-actions">
                <template v-if="editingPlanId === asPlan(row).id">
                  <UiButton variant="primary" size="sm" @click="savePlanEdit(asPlan(row).id)" :loading="loading">Save</UiButton>
                  <UiButton variant="ghost" size="sm" @click="cancelPlanEdit" :disabled="loading">Cancel</UiButton>
                </template>
                <template v-else>
                  <UiButton variant="ghost" size="sm" @click="startPlanEdit(asPlan(row))" :disabled="loading">Edit</UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    @click="togglePlanStatus(asPlan(row))"
                    :disabled="loading"
                    :class="{ 'text-danger': asPlan(row).status === 'active' }"
                  >
                    {{ asPlan(row).status === 'active' ? 'Archive' : 'Unarchive' }}
                  </UiButton>
                </template>
              </div>
            </template>
          </template>
        </UiTableShell>
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.billing-page {
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
  gap: 16px;
  align-items: center;
}

.control-input {
  width: 160px;
}

.checkbox-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: #444746;
  cursor: pointer;
  padding-bottom: 4px;
}

.error-alert {
  margin-bottom: 8px;
}

.admin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 24px;
}

.wide-card {
  grid-column: span 2;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.card-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
}

.admin-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.font-medium { font-weight: 500; }
.text-xs { font-size: 0.75rem; }
.text-danger { color: #d93025; }

.table-input {
  min-width: 120px;
}

.xs-input { width: 60px; }
.sm-input { width: 100px; }

.inline-fields {
  display: flex;
  gap: 8px;
}

.table-actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .wide-card {
    grid-column: span 1;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
type ProductItem = {
  id: string
  tenant_id: string
  product_key: string
  name: string
  app_key: string
  status: 'active' | 'archived'
}

type PlanItem = {
  id: string
  tenant_id: string
  product_id: string
  plan_key: string
  name: string
  billing_cycle: 'monthly' | 'yearly' | 'one_time' | 'custom'
  currency: string
  amount_minor: number
  trial_days: number
  entitlement_keys: string[]
  status: 'active' | 'archived'
}

type BillingCatalogResponse = {
  tenant_id: string
  products: ProductItem[]
  plans: PlanItem[]
}

const productColumns = [
  { key: 'product_key', label: 'Product Key' },
  { key: 'name', label: 'Name' },
  { key: 'app_key', label: 'App' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions' },
]

const planColumns = [
  { key: 'plan_key', label: 'Plan Key' },
  { key: 'product_id', label: 'Product' },
  { key: 'billing_cycle', label: 'Billing' },
  { key: 'price', label: 'Price' },
  { key: 'entitlements', label: 'Entitlements' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions' },
]

const config = useRuntimeConfig()
const tenantId = ref('tenant-demo')
const includeArchived = ref(false)
const loading = ref(false)
const error = ref('')
const products = ref<ProductItem[]>([])
const plans = ref<PlanItem[]>([])

const editingProductId = ref('')
const editingPlanId = ref('')

const createProduct = reactive({
  product_key: '',
  name: '',
  app_key: '',
})

const createPlan = reactive({
  product_id: '',
  plan_key: '',
  name: '',
  billing_cycle: 'monthly',
  currency: 'USD',
  amount_minor: 0,
  trial_days: 0,
  entitlement_keys: '',
})

const editProduct = reactive({
  product_key: '',
  name: '',
  app_key: '',
})

const editPlan = reactive({
  product_id: '',
  plan_key: '',
  name: '',
  billing_cycle: 'monthly',
  currency: 'USD',
  amount_minor: 0,
  trial_days: 0,
  entitlement_keys: '',
})

const asProduct = (row: Record<string, unknown>) => row as unknown as ProductItem
const asPlan = (row: Record<string, unknown>) => row as unknown as PlanItem

const statusBadgeVariant = (status: ProductItem['status'] | PlanItem['status']) => {
  return status === 'active' ? 'success' : 'danger'
}

const getAuthHeaders = () => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token')
  if (!token) {
    navigateTo('/login')
    return {}
  }
  return { authorization: `Bearer ${token}` }
}

const splitEntitlementKeys = (raw: string) => {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const productKeyById = (productId: string) => {
  const product = products.value.find((item) => item.id === productId)
  return product ? product.product_key : productId
}

const loadCatalog = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<BillingCatalogResponse>(`${config.public.apiBase}/billing/catalog`, {
      query: {
        tenant_id: tenantId.value,
        include_archived: includeArchived.value ? 'true' : 'false',
      },
      headers: getAuthHeaders(),
    })
    products.value = data.products || []
    plans.value = data.plans || []
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Load catalog failed'
  } finally {
    loading.value = false
  }
}

const manageProduct = async (payload: Record<string, unknown>) => {
  await $fetch(`${config.public.apiBase}/billing/products`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: {
      tenant_id: tenantId.value,
      ...payload,
    },
  })
}

const managePlan = async (payload: Record<string, unknown>) => {
  await $fetch(`${config.public.apiBase}/billing/plans`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: {
      tenant_id: tenantId.value,
      ...payload,
    },
  })
}

const createProductAction = async () => {
  loading.value = true
  error.value = ''
  try {
    await manageProduct({
      action: 'create',
      product_key: createProduct.product_key.trim(),
      name: createProduct.name.trim(),
      app_key: createProduct.app_key.trim(),
    })
    createProduct.product_key = ''
    createProduct.name = ''
    createProduct.app_key = ''
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Create product failed'
  } finally {
    loading.value = false
  }
}

const createPlanAction = async () => {
  loading.value = true
  error.value = ''
  try {
    await managePlan({
      action: 'create',
      product_id: createPlan.product_id,
      plan_key: createPlan.plan_key.trim(),
      name: createPlan.name.trim(),
      billing_cycle: createPlan.billing_cycle,
      currency: createPlan.currency.trim().toUpperCase(),
      amount_minor: Number(createPlan.amount_minor || 0),
      trial_days: Number(createPlan.trial_days || 0),
      entitlement_keys: splitEntitlementKeys(createPlan.entitlement_keys),
    })
    createPlan.product_id = ''
    createPlan.plan_key = ''
    createPlan.name = ''
    createPlan.billing_cycle = 'monthly'
    createPlan.currency = 'USD'
    createPlan.amount_minor = 0
    createPlan.trial_days = 0
    createPlan.entitlement_keys = ''
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Create plan failed'
  } finally {
    loading.value = false
  }
}

const startProductEdit = (product: ProductItem) => {
  editingProductId.value = product.id
  editProduct.product_key = product.product_key
  editProduct.name = product.name
  editProduct.app_key = product.app_key
}

const cancelProductEdit = () => {
  editingProductId.value = ''
  editProduct.product_key = ''
  editProduct.name = ''
  editProduct.app_key = ''
}

const saveProductEdit = async (id: string) => {
  loading.value = true
  error.value = ''
  try {
    await manageProduct({
      action: 'update',
      id,
      product_key: editProduct.product_key.trim(),
      name: editProduct.name.trim(),
      app_key: editProduct.app_key.trim(),
    })
    cancelProductEdit()
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update product failed'
  } finally {
    loading.value = false
  }
}

const toggleProductStatus = async (product: ProductItem) => {
  loading.value = true
  error.value = ''
  try {
    await manageProduct({
      action: product.status === 'active' ? 'archive' : 'unarchive',
      id: product.id,
    })
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update product status failed'
  } finally {
    loading.value = false
  }
}

const startPlanEdit = (plan: PlanItem) => {
  editingPlanId.value = plan.id
  editPlan.product_id = plan.product_id
  editPlan.plan_key = plan.plan_key
  editPlan.name = plan.name
  editPlan.billing_cycle = plan.billing_cycle
  editPlan.currency = plan.currency
  editPlan.amount_minor = plan.amount_minor
  editPlan.trial_days = plan.trial_days
  editPlan.entitlement_keys = plan.entitlement_keys.join(', ')
}

const cancelPlanEdit = () => {
  editingPlanId.value = ''
  editPlan.product_id = ''
  editPlan.plan_key = ''
  editPlan.name = ''
  editPlan.billing_cycle = 'monthly'
  editPlan.currency = 'USD'
  editPlan.amount_minor = 0
  editPlan.trial_days = 0
  editPlan.entitlement_keys = ''
}

const savePlanEdit = async (id: string) => {
  loading.value = true
  error.value = ''
  try {
    await managePlan({
      action: 'update',
      id,
      product_id: editPlan.product_id,
      plan_key: editPlan.plan_key.trim(),
      name: editPlan.name.trim(),
      billing_cycle: editPlan.billing_cycle,
      currency: editPlan.currency.trim().toUpperCase(),
      amount_minor: Number(editPlan.amount_minor || 0),
      trial_days: Number(editPlan.trial_days || 0),
      entitlement_keys: splitEntitlementKeys(editPlan.entitlement_keys),
    })
    cancelPlanEdit()
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update plan failed'
  } finally {
    loading.value = false
  }
}

const togglePlanStatus = async (plan: PlanItem) => {
  loading.value = true
  error.value = ''
  try {
    await managePlan({
      action: plan.status === 'active' ? 'archive' : 'unarchive',
      id: plan.id,
    })
    await loadCatalog()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Update plan status failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (process.client && !localStorage.getItem('sso_access_token')) {
    navigateTo('/login')
    return
  }
  loadCatalog()
})
</script>
