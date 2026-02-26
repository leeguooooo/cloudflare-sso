<template>
  <div class="leeguoo-logo" :class="[size, mode]">
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" class="logo-icon">
      <!-- 象征 L 的蓝色部分 -->
      <path d="M8 8V32H16" stroke="#4285F4" stroke-width="5" stroke-linecap="round" fill="none" />
      <!-- 象征 g 的红色外延 -->
      <path d="M32 32V16C32 11.5817 28.4183 8 24 8" stroke="#EA4335" stroke-width="5" stroke-linecap="round" fill="none" />
      <!-- 品牌核心：双 oo (黄色和绿色) -->
      <circle cx="18" cy="24" r="5" stroke="#FBBC05" stroke-width="4" fill="none" />
      <circle cx="28" cy="24" r="5" stroke="#34A853" stroke-width="4" fill="none" />
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
    default: 'md'
  },
  mode: {
    type: String,
    default: 'icon'
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

.sm { height: 24px; }
.sm .logo-text { font-size: 1.15rem; }

.md { height: 40px; }
.md .logo-text { font-size: 1.85rem; }

.lg { height: 64px; }
.lg .logo-text { font-size: 2.6rem; }

.l { color: #4285F4; }
.e1 { color: #EA4335; }
.e2 { color: #FBBC05; }
.g { color: #4285F4; }
.u { color: #34A853; }
.o1 { color: #EA4335; }
.o2 { color: #FBBC05; }
</style>
