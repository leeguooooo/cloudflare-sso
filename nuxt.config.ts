import { fileURLToPath } from 'node:url'

const i18nConfigPath = fileURLToPath(new URL('./i18n.config.ts', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2024-12-01',
  app: {
    pageTransition: { name: 'fade', mode: 'out-in' },
    head: {
      title: 'leeguoo Identity',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // Google AdSense site verification (Auto Ads, publisher ca-pub-4085449715128420).
        { name: 'google-adsense-account', content: 'ca-pub-4085449715128420' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
      ],
      // Third-party scripts (visitor beacon, GA4, AdSense Auto Ads) are injected by
      // plugins/third-party-scripts.client.ts so they can be skipped on the sign-in
      // pages shown inside native App Store apps (no ads/trackers in the auth sheet).
    },
  },
  css: [
    '@leeguoo/design-tokens/tokens.css',
    '@leeguoo/design-tokens/themes/google.css',
    '@leeguoo/design-tokens/themes/google-brand-sso.css',
    '@leeguoo/design-tokens/themes/admin-shell.css',
    '~/assets/css/main.css',
  ],
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
      defaultClientId: process.env.NUXT_PUBLIC_DEFAULT_CLIENT_ID || process.env.DEFAULT_CLIENT_ID || '',
      oidcIssuer: '',
      // Extra comma-separated client ids treated like native App Store clients
      // (email/password only). The built-in list lives in utils/auth-client.ts.
      nativeStoreClientIds: process.env.NUXT_PUBLIC_NATIVE_STORE_CLIENT_IDS || '',
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
