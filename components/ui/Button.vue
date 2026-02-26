<template>
  <button
    :class="[
      'btn',
      `btn-${variant}`,
      { 'btn-loading': loading },
      { 'btn-block': block }
    ]"
    :disabled="disabled || loading"
    v-bind="$attrs"
  >
    <span v-if="loading" class="spinner"></span>
    <span v-else>
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value: string) => ['primary', 'secondary', 'outline', 'ghost', 'danger'].includes(value)
  },
  loading: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  block: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.5rem;
  height: 2.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
  gap: 0.5rem;
  user-select: none;
}

.btn:focus-visible {
  outline: 2px solid var(--color-primary-600);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-block {
  width: 100%;
  display: flex;
}

/* Variants */
.btn-primary {
  background-color: var(--color-primary-600);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--color-primary-700);
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 3px 1px rgba(60,64,67,0.15);
}

.btn-primary:active:not(:disabled) {
  background-color: var(--color-primary-800);
}

.btn-secondary {
  background-color: white;
  color: var(--color-primary-600);
  border-color: var(--color-neutral-300);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-primary-50);
  border-color: var(--color-primary-100);
}

.btn-outline {
  background-color: transparent;
  border-color: var(--color-neutral-300);
  color: var(--color-primary-600);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--color-primary-50);
  border-color: var(--color-primary-100);
}

.btn-ghost {
  background-color: transparent;
  color: var(--color-primary-600);
  padding: 0 0.75rem;
}

.btn-ghost:hover:not(:disabled) {
  background-color: var(--color-primary-50);
}

.btn-danger {
  background-color: #d93025;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: #b22a21;
}

/* Loading Spinner */
.spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
