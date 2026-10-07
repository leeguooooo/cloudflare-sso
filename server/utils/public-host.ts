/**
 * Behind Alibaba Cloud ESA (mainland China), account.leeguoo.com / sso.leeguoo.com reach this Pages project as
 * cloudflare-sso.pages.dev with the public name in X-Forwarded-Host. Only these names are trusted: someone sending
 * the header straight to pages.dev just gets the same behaviour as visiting the public hostname.
 * Managed with ~/github.com/leeguoo-edge.
 */
export const PUBLIC_HOSTS = new Set(['account.leeguoo.com', 'sso.leeguoo.com'])

/** The public hostname to serve as, or null to leave the request alone. */
export const publicHostFor = (host: string | undefined, forwardedHost: string | undefined): string | null => {
  const forwarded = (forwardedHost || '').split(',')[0].trim().toLowerCase()
  if (!forwarded || !PUBLIC_HOSTS.has(forwarded)) return null
  if ((host || '').toLowerCase() === forwarded) return null
  return forwarded
}
