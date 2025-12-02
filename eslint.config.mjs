import eslintConfigPrettier from 'eslint-config-prettier'
import tsParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const vueEssential = vue.configs['flat/essential']

export default [
  {
    ignores: ['dist', '.output', 'node_modules'],
  },
  {
    files: ['**/*.{js,ts,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { vue },
    rules: {
      ...vueEssential.rules,
      'vue/multi-word-component-names': 'off',
    },
  },
  eslintConfigPrettier,
]
