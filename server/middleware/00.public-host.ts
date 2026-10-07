import { defineEventHandler } from 'h3'
import { publicHostFor } from '../utils/public-host'

// Runs before every other handler (middleware run in file-name order): restore the public hostname so
// issuers, redirect URIs, default-client choice and same-origin checks all see account/sso.leeguoo.com.
export default defineEventHandler((event) => {
  const headers = event.node.req.headers
  const host = publicHostFor(headers.host as string | undefined, headers['x-forwarded-host'] as string | undefined)
  if (host) headers.host = host
})
