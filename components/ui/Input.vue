<template>
  <div class="form-group">
    <label v-if="label" :for="id" class="form-label">
      {{ label }}
      <span v-if="required" class="required">*</span>
    </label>
    <div class="input-wrapper">
      <input
        :id="id"
        :value="modelValue"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :class="['form-input', { 'has-error': error }]"
        v-bind="$attrs"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-else-if="help" class="form-help">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  label: {
    type: String,
    default: ''
  },
  id: {
    type: String,
    default: () => `input-${Math.random().toString(36).substr(2, 9)}`
  },
  type: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    default: ''
  },
  error: {
    type: String,
    default: ''
  },
  help: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  required: {
    type: Boolean,
    default: false
  }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.required {
  color: #ef4444;
  margin-left: 0.125rem;
}

.input-wrapper {
  position: relative;
}

.form-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  font-size: var(--font-size-sm);
  line-height: 1.25rem;
  color: var(--color-text-primary);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

.form-input:disabled {
  background-color: var(--color-neutral-50);
  color: var(--color-text-tertiary);
  cursor: not-allowed;
}

.form-input.has-error {
  border-color: #ef4444;
}

.form-input.has-error:focus {
  box-shadow: 0 0 0 3px #fee2e2;
}

.form-error {
  font-size: 0.75rem;
  color: #ef4444;
}

.form-help {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}
</style>
