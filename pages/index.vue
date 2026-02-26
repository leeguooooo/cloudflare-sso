<template>
  <div class="landing">
    <div class="hero">
      <UiLogo size="lg" mode="full" />
      <p>One account. All of leeguoo Identity working for you.</p>
    </div>

    <div class="actions">
      <NuxtLink class="action-card" to="/account">
        <div class="card-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21a8 8 0 1 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div class="card-content">
          <h2>Account Center</h2>
          <p>Manage your login, security, and personal info in one place.</p>
        </div>
      </NuxtLink>
      <NuxtLink class="action-card" to="/admin">
        <div class="card-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </div>
        <div class="card-content">
          <h2>Admin Console</h2>
          <p>Configure clients, roles, and manage billing entitlements.</p>
        </div>
      </NuxtLink>
    </div>

    <div class="auth-cta">
      <UiButton variant="primary" to="/login">Sign in</UiButton>
      <UiButton variant="ghost" to="/register">Create account</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})
</script>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero {
  text-align: center;
}

.google-logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
}

.hero h1 {
  font-size: 2.25rem;
  font-weight: 400;
  line-height: 2.75rem;
  margin-bottom: 8px;
  color: #1f1f1f;
}

.hero p {
  color: #444746;
  font-size: 1rem;
  line-height: 1.5rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #dadce0;
  border-radius: 12px;
  background: white;
  padding: 16px;
  text-decoration: none;
  transition: background-color 0.2s;
}

.action-card:hover {
  background-color: #f7f9fc;
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #e8f0fe;
  color: #1a73e8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-content h2 {
  font-size: 1rem;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 4px;
}

.card-content p {
  color: #444746;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.auth-cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
}
</style>
