<template>
  <div class="leeguoo-logo" :class="[size, mode]">
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" class="logo-icon">
      <!-- 象征 L 的垂直部分 -->
      <path d="M12 8V32" stroke="#4285F4" stroke-width="6" stroke-linecap="round" />
      <!-- 象征 oo 的双环结构 -->
      <circle cx="22" cy="28" r="6" stroke="#34A853" stroke-width="4" fill="none" />
      <circle cx="30" cy="28" r="6" stroke="#FBBC05" stroke-width="4" fill="none" />
      <!-- 象征安全的小红点 -->
      <circle cx="30" cy="28" r="2" fill="#EA4335" />
    </svg>
    <span v-if="mode === 'full'" class="logo-text">
      <span class="l">l</span>
      <span class="e1">e</span>
      <span class="e2">e</span>
      <span class="g">g</span>
      <span class="u">u</span>
      <span class="o1">o</span>
      <span class="o2">o</span>
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps({
  size: {
    type: String,
    default: 'md' // sm, md, lg
  },
  mode: {
    type: String,
    default: 'icon' // icon, full
  }
})
</script>

<style scoped>
.leeguoo-logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}

.logo-icon {
  height: 100%;
}

.logo-text {
  font-family: 'Google Sans', 'Roboto', sans-serif;
  font-weight: 500;
  letter-spacing: -0.5px;
}

/* Sizes */
.sm { height: 24px; }
.sm .logo-text { font-size: 1.1rem; }

.md { height: 40px; }
.md .logo-text { font-size: 1.75rem; }

.lg { height: 64px; }
.lg .logo-text { font-size: 2.5rem; }

/* Colors for Text */
.l { color: #4285F4; }
.e1 { color: #EA4335; }
.e2 { color: #FBBC05; }
.g { color: #4285F4; }
.u { color: #34A853; }
.o1 { color: #EA4335; }
.o2 { color: #FBBC05; }
</style>
