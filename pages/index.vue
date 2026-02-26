<template>
  <div class="landing-page">
    <div class="hero">
      <UiLogo size="lg" mode="full" class="main-logo" />
      <p class="hero-subtitle">One account. All of leeguoo Identity working for you.</p>
    </div>

    <div class="action-grid">
      <NuxtLink class="feature-card" to="/account">
        <div class="card-icon privacy">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21a8 8 0 1 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div class="card-text">
          <h3>Account Center</h3>
          <p>Manage your personal info, security, and data privacy.</p>
        </div>
        <div class="card-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </NuxtLink>

      <NuxtLink class="feature-card" to="/admin">
        <div class="card-icon admin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </div>
        <div class="card-text">
          <h3>Admin Console</h3>
          <p>Manage applications, roles, and identity federation.</p>
        </div>
        <div class="card-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </NuxtLink>
    </div>

    <div class="auth-section">
      <UiButton variant="primary" to="/login" class="cta-btn">Sign in</UiButton>
      <UiButton variant="ghost" to="/register" class="cta-btn">Create account</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})
</script>

<style scoped>
.landing-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.hero {
  text-align: center;
  margin-bottom: 40px;
}

.main-logo {
  margin-bottom: 16px;
}

.hero-subtitle {
  font-size: 1rem;
  color: #444746;
  line-height: 1.5;
  max-width: 320px;
  margin: 0 auto;
}

.action-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin-bottom: 32px;
}

.feature-card {
  display: flex;
  align-items: center;
  padding: 20px;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  text-decoration: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.feature-card:hover {
  background-color: #f8f9fa;
  border-color: #bdc1c6;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 3px 1px rgba(60,64,67,0.15);
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
  flex-shrink: 0;
}

.card-icon.privacy { background-color: #e8f0fe; color: #1a73e8; }
.card-icon.admin { background-color: #fef7e0; color: #fbbc04; }

.card-text {
  flex: 1;
}

.card-text h3 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 4px;
}

.card-text p {
  font-size: 0.875rem;
  color: #444746;
  line-height: 1.4;
}

.card-arrow {
  color: #5f6368;
  margin-left: 8px;
}

.auth-section {
  display: flex;
  gap: 12px;
  justify-content: center;
  width: 100%;
}

.cta-btn {
  min-width: 120px;
}

@media (max-width: 600px) {
  .hero-subtitle {
    font-size: 0.9375rem;
  }
  
  .feature-card {
    padding: 16px;
  }
}
</style>
