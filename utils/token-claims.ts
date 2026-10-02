/**
 * Reads claims from the access token the hosted pages keep in localStorage.
 * Display-only: the server re-verifies the token on every API call, so nothing
 * here is trusted for authorization.
 */
export const storedTokenClaims = (): Record<string, unknown> => {
  if (!process.client) return {}
  const token = localStorage.getItem('sso_access_token') || ''
  const payload = token.split('.')[1]
  if (!payload) return {}
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(atob(base64), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    )
    const claims = JSON.parse(json)
    return claims && typeof claims === 'object' ? claims : {}
  } catch {
    return {}
  }
}

/** Tenant of the signed-in user (`tid` claim), or '' when unknown. */
export const storedTokenTenantId = () => {
  const tid = storedTokenClaims().tid
  return typeof tid === 'string' ? tid : ''
}
