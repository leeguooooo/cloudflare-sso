<template>
  <NuxtLayout name="auth">
    <div class="landing">
      <div class="hero">
        <svg class="google-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <h1>Identity Hub</h1>
        <p>One account. All of Identity Hub working for you.</p>
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
  </NuxtLayout>
</template>

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
