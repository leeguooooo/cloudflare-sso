import { getRequestURL, H3Event } from 'h3'
import { getEnv } from './env'

const DEMO_DEFAULT_CLIENT_ID = 'demo-web'
const MISONOTE_DEFAULT_CLIENT_ID = 'misonote-app-web'

const resolveDefaultByHostname = (hostname: string) => {
  if (!hostname) return DEMO_DEFAULT_CLIENT_ID
  if (hostname === 'account.misonote.com') return MISONOTE_DEFAULT_CLIENT_ID
  if (hostname.endsWith('.misonote.com')) return MISONOTE_DEFAULT_CLIENT_ID
  return DEMO_DEFAULT_CLIENT_ID
}

export const resolveDefaultClientId = (event: H3Event) => {
  const env = getEnv(event)
  const configured = (env.DEFAULT_CLIENT_ID || '').trim()
  if (configured) return configured
  const hostname = getRequestURL(event).hostname.toLowerCase()
  return resolveDefaultByHostname(hostname)
}
