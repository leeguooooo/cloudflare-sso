<template>
  <div class="auth-layout">
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-card-content">
          <slot />
        </div>
        <div class="auth-visual">
          <div class="visual-content">
            <UiLogo size="lg" mode="icon" />
            <h2>One account. All of leeguoo Identity working for you.</h2>
            <p>Securely access all your applications with a single identity.</p>
          </div>
        </div>
      </div>
      <footer class="auth-footer">
        <nav class="footer-links">
          <a href="#">Help</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </nav>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.auth-layout {
  min-height: 100vh;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: 'Google Sans', 'Roboto', 'Inter', sans-serif;
}

.auth-container {
  width: min(1040px, 100%);
  display: flex;
  flex-direction: column;
}

.auth-card {
  background: #ffffff;
  border-radius: 28px;
  border: 1px solid #dadce0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 500px;
  overflow: hidden;
}

.auth-card-content {
  padding: 48px;
  display: flex;
  flex-direction: column;
}

.auth-visual {
  padding: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.visual-content {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.google-logo {
  width: 48px;
  height: 48px;
  margin-bottom: 24px;
}

.visual-content h2 {
  font-size: 1.5rem;
  font-weight: 400;
  line-height: 2rem;
  margin-bottom: 1rem;
  color: #1f1f1f;
}

.visual-content p {
  font-size: 1rem;
  color: #444746;
  line-height: 1.5rem;
}

.auth-footer {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  padding: 0 8px;
}

.footer-links {
  display: flex;
  gap: 24px;
}

.footer-links a {
  color: #444746;
  text-decoration: none;
  font-size: 0.75rem;
  padding: 8px;
  border-radius: 4px;
}

.footer-links a:hover {
  background-color: #f7f9fc;
}

@media (max-width: 900px) {
  .auth-card {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .auth-visual {
    display: none;
  }

  .auth-card-content {
    padding: 36px 24px;
  }

  .auth-footer {
    justify-content: center;
  }
}
</style>
