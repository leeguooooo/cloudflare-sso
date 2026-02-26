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
  gap: 0.25rem;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-neutral-800);
  margin-left: 0.25rem;
}

.required {
  color: #d93025;
  margin-left: 0.125rem;
}

.input-wrapper {
  position: relative;
}

.form-input {
  width: 100%;
  height: 3rem;
  padding: 0 0.875rem;
  font-size: 1rem;
  color: var(--color-neutral-900);
  background-color: white;
  border: 1px solid var(--color-neutral-300);
  border-radius: 4px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input::placeholder {
  color: var(--color-neutral-600);
}

.form-input:hover:not(:disabled) {
  border-color: var(--color-neutral-900);
}

.form-input:focus {
  outline: none;
  border: 2px solid var(--color-primary-600);
  padding: 0 0.8125rem; /* Account for 2px border */
}

.form-input:disabled {
  background-color: var(--color-neutral-50);
  border-color: var(--color-neutral-200);
  color: var(--color-neutral-500);
  cursor: not-allowed;
}

.form-input.has-error {
  border-color: #d93025;
}

.form-input.has-error:focus {
  border-color: #d93025;
}

.form-error {
  font-size: 0.75rem;
  color: #d93025;
  margin-left: 0.25rem;
}

.form-help {
  font-size: 0.75rem;
  color: var(--color-neutral-600);
  margin-left: 0.25rem;
}
</style>
