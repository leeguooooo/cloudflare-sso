<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-content">
        <UiLogo size="lg" mode="icon" />
        
        <div v-if="error?.statusCode === 404" class="error-message">
          <h1>404. <span>That’s an error.</span></h1>
          <p>The requested URL was not found on this server. <span class="muted">That’s all we know.</span></p>
        </div>
        <div v-else class="error-message">
          <h1>Error. <span>That’s an error.</span></h1>
          <p>An unexpected error occurred. <span class="muted">That’s all we know.</span></p>
          <pre v-if="error?.message" class="error-detail">{{ error.message }}</pre>
        </div>

        <div class="error-actions">
          <NuxtLink to="/" class="error-link">Go to leeguoo Identity home</NuxtLink>
        </div>
      </div>
      
      <div class="error-visual">
        <!-- Minimal Google-style broken robot placeholder SVG -->
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="80" stroke="#DADCE0" stroke-width="2" stroke-dasharray="10 10"/>
          <rect x="70" y="80" width="60" height="40" rx="4" fill="#F1F3F4"/>
          <circle cx="85" cy="95" r="4" fill="#BDC1C6"/>
          <circle cx="115" cy="95" r="4" fill="#BDC1C6"/>
          <path d="M85 110C85 110 92.5 105 100 105C107.5 105 115 110 115 110" stroke="#BDC1C6" stroke-width="2" stroke-linecap="round"/>
          <line x1="100" y1="60" x2="100" y2="80" stroke="#BDC1C6" stroke-width="2"/>
          <circle cx="100" cy="55" r="5" fill="#F1F3F4" stroke="#BDC1C6" stroke-width="2"/>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  error: Object
})
</script>

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: #ffffff;
  font-family: 'Google Sans', 'Roboto', sans-serif;
}

.error-container {
  display: flex;
  align-items: flex-start;
  gap: 80px;
  max-width: 800px;
  width: 100%;
}

.error-content {
  flex: 1;
}

.google-logo {
  width: 48px;
  height: 48px;
  margin-bottom: 24px;
}

.error-message h1 {
  font-size: 1.125rem;
  font-weight: 500;
  color: #202124;
  margin-bottom: 12px;
}

.error-message h1 span {
  color: #70757a;
  font-weight: 400;
}

.error-message p {
  font-size: 1rem;
  line-height: 1.5;
  color: #202124;
  margin-bottom: 24px;
}

.muted {
  color: #70757a;
}

.error-detail {
  font-family: 'Roboto Mono', monospace;
  font-size: 0.75rem;
  background-color: #f8f9fa;
  padding: 12px;
  border-radius: 4px;
  color: #5f6368;
  margin-bottom: 24px;
  white-space: pre-wrap;
}

.error-actions {
  margin-top: 32px;
}

.error-link {
  color: #1a73e8;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
}

.error-link:hover {
  text-decoration: underline;
}

@media (max-width: 600px) {
  .error-container {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 40px;
  }
  .error-visual {
    order: -1;
  }
}
</style>
