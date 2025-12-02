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
  padding: 0.625rem 1rem;
  font-size: var(--font-size-sm);
  font-weight: 500;
  line-height: 1.25rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
  gap: 0.5rem;
}

.btn:focus-visible {
  outline: 2px solid var(--color-primary-600);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
}

.btn-secondary {
  background-color: white;
  color: var(--color-text-primary);
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-neutral-50);
  border-color: var(--color-border-hover);
}

.btn-outline {
  background-color: transparent;
  border-color: var(--color-primary-600);
  color: var(--color-primary-600);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--color-primary-50);
}

.btn-ghost {
  background-color: transparent;
  color: var(--color-text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background-color: var(--color-neutral-100);
  color: var(--color-text-primary);
}

.btn-danger {
  background-color: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: #dc2626;
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
