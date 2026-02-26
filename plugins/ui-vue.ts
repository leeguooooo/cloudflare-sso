import {
  Alert as UiAlert,
  Badge as UiBadge,
  Button as UiButton,
  Card as UiCard,
  Checkbox as UiCheckbox,
  Input as UiInput,
  Logo as UiLogo,
  Select as UiSelect,
  TableShell as UiTableShell,
  Textarea as UiTextarea,
} from '@leeguoo/leeguoo-ui-vue'

export default defineNuxtPlugin((nuxtApp) => {
  const app = nuxtApp.vueApp

  app.component('UiAlert', UiAlert)
  app.component('UiBadge', UiBadge)
  app.component('UiButton', UiButton)
  app.component('UiCard', UiCard)
  app.component('UiCheckbox', UiCheckbox)
  app.component('UiInput', UiInput)
  app.component('UiLogo', UiLogo)
  app.component('UiSelect', UiSelect)
  app.component('UiTableShell', UiTableShell)
  app.component('UiTextarea', UiTextarea)
})
