import { hideSocialLogin } from '~/utils/auth-client'

/**
 * Loads the site-wide third-party scripts (first-party visitor beacon, GA4,
 * AdSense Auto Ads) that used to sit in app.head.
 *
 * They are skipped when the page is the sign-in / register sheet of a native
 * App Store client (ASWebAuthenticationSession): ads or trackers inside an
 * app's login sheet are an App Review problem (2.3 / 5.1.2) and the apps'
 * privacy labels do not declare them.
 *
 * Also skipped on the TV device-approval page and on the sign-in that leads
 * to it: an Auto Ad landing next to "Allow" on a page that grants a device
 * access to the account is one mis-tap away from a wrong approval.
 */
const AUTH_PAGE_RE = /^\/(?:[a-z]{2}\/)?(?:login|register)\/?$/
const DEVICE_PAGE_RE = /^\/(?:[a-z]{2}\/)?device\/?$/

const addScript = (attrs: Record<string, string | boolean>, inline?: string) => {
  const el = document.createElement('script')
  for (const [key, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(key, '')
    else if (typeof value === 'string') el.setAttribute(key, value)
  }
  if (inline) el.text = inline
  document.head.appendChild(el)
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const url = new URL(window.location.href)
  const query = Object.fromEntries(url.searchParams.entries())
  const extra = typeof config.public.nativeStoreClientIds === 'string' ? config.public.nativeStoreClientIds : ''
  if (AUTH_PAGE_RE.test(url.pathname) && hideSocialLogin(query, extra)) {
    return
  }
  const continuePath = (query.continue || '').split('?')[0]
  if (DEVICE_PAGE_RE.test(url.pathname) || (AUTH_PAGE_RE.test(url.pathname) && DEVICE_PAGE_RE.test(continuePath))) {
    return
  }

  // First-party visitor analytics — posts to the central collector on blog.leeguoo.com.
  addScript({ src: 'https://blog.leeguoo.com/scripts/visitor-beacon.js?v=20260629-2', defer: true })
  // Google Analytics 4 — shared leeguoo property (542876134); segment by hostname.
  addScript({ src: 'https://www.googletagmanager.com/gtag/js?id=G-RCV0Z432Y8', async: true })
  addScript(
    {},
    "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-RCV0Z432Y8');",
  )
  // Google AdSense Auto Ads loader (publisher ca-pub-4085449715128420).
  addScript({
    src: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4085449715128420',
    async: true,
    crossorigin: 'anonymous',
  })
})
