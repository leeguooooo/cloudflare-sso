<template>
  <NuxtLayout name="auth">
    <div class="landing">
      <div class="hero">
        <div class="logo">ID</div>
        <h1>Identity Platform</h1>
        <p>One account for all your apps, with centralized auth and subscription operations.</p>
      </div>

      <div class="actions">
        <NuxtLink class="action-card" to="/portal">
          <h2>User Portal</h2>
          <p>Profile, sessions, and subscription overview for end users.</p>
        </NuxtLink>
        <NuxtLink class="action-card" to="/admin">
          <h2>Admin Console</h2>
          <p>Manage clients, roles, and billing integration from one place.</p>
        </NuxtLink>
      </div>

      <div class="auth-cta">
        <NuxtLink to="/login" class="link">Sign in</NuxtLink>
        <span>or</span>
        <NuxtLink to="/register" class="link">Create account</NuxtLink>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.hero {
  text-align: center;
}

.logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 1rem;
  border-radius: 10px;
  background: var(--color-primary-600);
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
}

.hero h1 {
  margin-bottom: 0.75rem;
}

.hero p {
  color: var(--color-text-secondary);
}

.actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.action-card {
  display: block;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: white;
  padding: 1rem;
}

.action-card h2 {
  font-size: 1rem;
  margin-bottom: 0.5rem;
}

.action-card p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.auth-cta {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.link {
  font-weight: 600;
}

@media (max-width: 800px) {
  .actions {
    grid-template-columns: 1fr;
  }
}
</style>
