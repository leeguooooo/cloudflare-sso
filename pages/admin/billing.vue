<template>
  <NuxtLayout name="default">
    <div class="billing-page">
      <section class="toolbar">
        <label>
          Tenant
          <input v-model="tenantId" class="field" />
        </label>
        <label class="checkbox">
          <input v-model="includeArchived" type="checkbox" />
          Show archived
        </label>
        <button class="btn-primary" @click="loadCatalog" :disabled="loading">
          {{ loading ? 'Loading...' : 'Reload Catalog' }}
        </button>
      </section>

      <section class="card">
        <h2>Billing Control Plane</h2>
        <p class="muted">
          Product/Plan mapping management is live. Use this page to maintain pricing plans and entitlement keys.
        </p>
        <p v-if="error" class="error">{{ error }}</p>
      </section>

      <section class="card">
        <h3>Create Product</h3>
        <div class="form-grid">
          <label>
            Product Key
            <input v-model="createProduct.product_key" class="field" placeholder="blog-premium" />
          </label>
          <label>
            Name
            <input v-model="createProduct.name" class="field" placeholder="Blog Premium" />
          </label>
          <label>
            App Key
            <input v-model="createProduct.app_key" class="field" placeholder="blog | paste | cherry" />
          </label>
          <button class="btn-primary" @click="createProductAction" :disabled="loading">Create Product</button>
        </div>
      </section>

      <section class="card">
        <h3>Create Plan</h3>
        <div class="form-grid">
          <label>
            Product
            <select v-model="createPlan.product_id" class="field">
              <option value="">Select product</option>
              <option v-for="product in products" :key="product.id" :value="product.id">
                {{ product.product_key }} ({{ product.name }})
              </option>
            </select>
          </label>
          <label>
            Plan Key
            <input v-model="createPlan.plan_key" class="field" placeholder="paste-monthly" />
          </label>
          <label>
            Name
            <input v-model="createPlan.name" class="field" placeholder="Paste Monthly" />
          </label>
          <label>
            Billing Cycle
            <select v-model="createPlan.billing_cycle" class="field">
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
              <option value="one_time">one_time</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label>
            Currency
            <input v-model="createPlan.currency" class="field" placeholder="USD" />
          </label>
          <label>
            Amount (minor)
            <input v-model.number="createPlan.amount_minor" class="field" type="number" min="0" />
          </label>
          <label>
            Trial Days
            <input v-model.number="createPlan.trial_days" class="field" type="number" min="0" />
          </label>
          <label>
            Entitlement Keys (comma separated)
            <input v-model="createPlan.entitlement_keys" class="field" placeholder="blog.read.premium,paste.pro" />
          </label>
          <button class="btn-primary" @click="createPlanAction" :disabled="loading">Create Plan</button>
        </div>
      </section>

      <section class="card">
        <h3>Products</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Product Key</th>
              <th>Name</th>
              <th>App</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="product in products" :key="product.id">
              <td>
                <input v-if="editingProductId === product.id" v-model="editProduct.product_key" class="field compact" />
                <span v-else>{{ product.product_key }}</span>
              </td>
              <td>
                <input v-if="editingProductId === product.id" v-model="editProduct.name" class="field compact" />
                <span v-else>{{ product.name }}</span>
              </td>
              <td>
                <input v-if="editingProductId === product.id" v-model="editProduct.app_key" class="field compact" />
                <span v-else>{{ product.app_key }}</span>
              </td>
              <td>
                <span class="badge" :class="product.status">{{ product.status }}</span>
              </td>
              <td>
                <div class="actions">
                  <template v-if="editingProductId === product.id">
                    <button class="btn-primary btn-sm" @click="saveProductEdit(product.id)" :disabled="loading">Save</button>
                    <button class="btn-secondary btn-sm" @click="cancelProductEdit" :disabled="loading">Cancel</button>
                  </template>
                  <template v-else>
                    <button class="btn-secondary btn-sm" @click="startProductEdit(product)" :disabled="loading">Edit</button>
                    <button class="btn-danger btn-sm" @click="toggleProductStatus(product)" :disabled="loading">
                      {{ product.status === 'active' ? 'Archive' : 'Unarchive' }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
            <tr v-if="products.length === 0">
              <td colspan="5" class="muted">No products found.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>Plans</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Plan Key</th>
              <th>Product</th>
              <th>Billing</th>
              <th>Price</th>
              <th>Entitlements</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id">
              <td>
                <input v-if="editingPlanId === plan.id" v-model="editPlan.plan_key" class="field compact" />
                <span v-else>{{ plan.plan_key }}</span>
              </td>
              <td>
                <select v-if="editingPlanId === plan.id" v-model="editPlan.product_id" class="field compact">
                  <option v-for="product in products" :key="product.id" :value="product.id">
                    {{ product.product_key }}
                  </option>
                </select>
                <span v-else>{{ productKeyById(plan.product_id) }}</span>
              </td>
              <td>
                <span v-if="editingPlanId !== plan.id">{{ plan.billing_cycle }}</span>
                <select v-else v-model="editPlan.billing_cycle" class="field compact">
                  <option value="monthly">monthly</option>
                  <option value="yearly">yearly</option>
                  <option value="one_time">one_time</option>
                  <option value="custom">custom</option>
                </select>
              </td>
              <td>
                <div v-if="editingPlanId === plan.id" class="inline-fields">
                  <input v-model="editPlan.currency" class="field compact xs" />
                  <input v-model.number="editPlan.amount_minor" class="field compact sm" type="number" min="0" />
                </div>
                <span v-else>{{ plan.currency }} {{ plan.amount_minor }}</span>
              </td>
              <td>
                <input
                  v-if="editingPlanId === plan.id"
                  v-model="editPlan.entitlement_keys"
                  class="field compact"
                />
                <span v-else>{{ plan.entitlement_keys.join(', ') }}</span>
              </td>
              <td>
                <span class="badge" :class="plan.status">{{ plan.status }}</span>
              </td>
              <td>
                <div class="actions">
                  <template v-if="editingPlanId === plan.id">
                    <button class="btn-primary btn-sm" @click="savePlanEdit(plan.id)" :disabled="loading">Save</button>
                    <button class="btn-secondary btn-sm" @click="cancelPlanEdit" :disabled="loading">Cancel</button>
                  </template>
                  <template v-else>
                    <button class="btn-secondary btn-sm" @click="startPlanEdit(plan)" :disabled="loading">Edit</button>
                    <button class="btn-danger btn-sm" @click="togglePlanStatus(plan)" :disabled="loading">
                      {{ plan.status === 'active' ? 'Archive' : 'Unarchive' }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
            <tr v-if="plans.length === 0">
              <td colspan="7" class="muted">No plans found.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </NuxtLayout>
</template>

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

<style scoped>
.billing-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.toolbar {
  display: flex;
  align-items: end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.toolbar label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.checkbox {
  flex-direction: row !important;
  align-items: center;
  gap: 0.45rem !important;
  padding-bottom: 0.4rem;
}

.card {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1rem;
}

.card h2,
.card h3 {
  margin-bottom: 0.5rem;
}

.muted {
  color: var(--color-text-secondary);
}

.error {
  margin-top: 0.5rem;
  color: #b3261e;
}

.field {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  min-width: 180px;
}

.field.compact {
  min-width: 0;
  width: 100%;
}

.field.xs {
  width: 80px;
}

.field.sm {
  width: 120px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: 0.82rem;
}

.table th,
.table td {
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  padding: 0.625rem;
  vertical-align: top;
}

.actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.inline-fields {
  display: flex;
  gap: 0.35rem;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  border-radius: var(--radius-md);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary {
  border-color: var(--color-primary-600);
  background: var(--color-primary-600);
  color: white;
}

.btn-secondary {
  border-color: var(--color-border);
  background: white;
  color: var(--color-text-primary);
}

.btn-danger {
  border-color: #b3261e;
  background: #b3261e;
  color: white;
}

.btn-sm {
  padding: 0.4rem 0.55rem;
  font-size: 0.75rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
}

.badge.active {
  background: #e8f5e9;
  color: #137333;
}

.badge.archived {
  background: #fce8e6;
  color: #b3261e;
}

@media (max-width: 1080px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .table {
    font-size: 0.74rem;
  }
}
</style>
