<template>
  <div class="auth-layout">
    <div class="auth-content">
      <div class="auth-card">
        <slot />
      </div>
      <div class="auth-footer">
        <p>&copy; {{ new Date().getFullYear() }} Cloudflare SSO. All rights reserved.</p>
      </div>
    </div>
    <div class="auth-visual">
      <div class="visual-content">
        <h2>Enterprise Security,<br>Simplified.</h2>
        <p>Secure access to all your applications with a single identity.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-layout {
  display: flex;
  min-height: 100vh;
  background-color: var(--color-neutral-50);
}

.auth-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  position: relative;
}

.auth-card {
  width: 100%;
  max-width: 440px;
}

.auth-footer {
  position: absolute;
  bottom: 2rem;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.auth-visual {
  flex: 1;
  background: linear-gradient(135deg, var(--color-primary-900) 0%, var(--color-primary-700) 100%);
  display: none;
  flex-direction: column;
  justify-content: center;
  padding: 4rem;
  color: white;
}

.visual-content h2 {
  font-size: 3rem;
  line-height: 1.1;
  margin-bottom: 1.5rem;
  color: white;
}

.visual-content p {
  font-size: 1.25rem;
  color: var(--color-primary-100);
  max-width: 400px;
}

@media (min-width: 1024px) {
  .auth-visual {
    display: flex;
  }
}
</style>
