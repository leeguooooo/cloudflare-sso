const isHttpLike = (protocol: string) => protocol === 'http:' || protocol === 'https:'

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') return '/'
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed || '/'
}

// Keep strict matching semantics except for a common web edge case:
// treat `/callback` and `/callback/` as equivalent for http(s) redirect URIs.
export const normalizeRedirectUriForMatch = (input: string): string => {
  const value = String(input || '').trim()
  if (!value) return ''

  try {
    const url = new URL(value)
    if (isHttpLike(url.protocol)) {
      url.pathname = normalizePathname(url.pathname)
    }
    return url.toString()
  } catch {
    return value
  }
}
