import { fileURLToPath } from 'node:url'

const i18nConfigPath = fileURLToPath(new URL('./i18n.config.ts', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2024-12-01',
  app: {
    pageTransition: { name: 'fade', mode: 'out-in' },
    head: {
      title: 'Identity Hub',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  ssr: false,
  pages: true,
  devtools: { enabled: true },
  modules: ['@pinia/nuxt', '@nuxtjs/i18n'],
  nitro: {
    preset: 'cloudflare-pages',
  },
  i18n: {
    strategy: 'prefix_except_default',
    detectBrowserLanguage: false,
    locales: [
      { code: 'en', name: 'English' },
      { code: 'zh', name: '简体中文' },
    ],
    defaultLocale: 'en',
    vueI18n: i18nConfigPath,
  },
  runtimeConfig: {
    public: {
      apiBase: '/api',
      oidcIssuer: '',
      turnstileSiteKey: '',
    },
  },
  vite: {
    server: {
      hmr: {
        port: 24700,
        host: '127.0.0.1',
      },
    },
  },
})
