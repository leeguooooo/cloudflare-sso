<template>
  <NuxtLayout name="default">
    <div class="billing-page">
      <section class="card">
        <h2>Billing Control Plane</h2>
        <p class="muted">
          This module is the management UI for product plans and cross-application entitlements.
          It should connect to the billing service tables: products, plans, subscriptions, entitlements.
        </p>
      </section>

      <section class="grid">
        <article class="card">
          <h3>Phase 1</h3>
          <p>Create products and plans for each app:</p>
          <ul>
            <li><code>blog</code>: yearly premium</li>
            <li><code>paste</code>: monthly/yearly pro</li>
          </ul>
        </article>

        <article class="card">
          <h3>Phase 2</h3>
          <p>Bind plan to entitlements:</p>
          <ul>
            <li><code>blog.read.premium</code></li>
            <li><code>paste.pro</code></li>
          </ul>
        </article>

        <article class="card">
          <h3>Phase 3</h3>
          <p>Connect webhooks and manual operations:</p>
          <ul>
            <li>Stripe webhook ingest</li>
            <li>Manual activation / refund / revoke</li>
          </ul>
        </article>
      </section>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.billing-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
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

ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

@media (max-width: 980px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
