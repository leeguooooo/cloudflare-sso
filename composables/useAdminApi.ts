/**
 * Shared plumbing for the admin console pages: bearer header from the stored access token,
 * the API base, and a readable error message from an h3 error response.
 */
export const useAdminApi = () => {
  const config = useRuntimeConfig()

  const authHeaders = (): Record<string, string> => {
    if (!process.client) return {}
    const token = localStorage.getItem('sso_access_token')
    if (!token) {
      navigateTo('/login')
      return {}
    }
    return { authorization: `Bearer ${token}` }
  }

  const errorText = (err: any, fallback: string): string =>
    err?.data?.statusMessage || err?.data?.message || err?.message || fallback

  const get = <T>(path: string, query?: Record<string, unknown>) =>
    $fetch<T>(`${config.public.apiBase}${path}`, { query, headers: authHeaders() })

  const post = <T>(path: string, body: Record<string, unknown>) =>
    $fetch<T>(`${config.public.apiBase}${path}`, { method: 'POST', body, headers: authHeaders() })

  const signedIn = () => !process.client || Boolean(localStorage.getItem('sso_access_token'))

  return { authHeaders, errorText, get, post, signedIn }
}

export type AdminTenant = { id: string; name: string; domain: string | null; users: number; clients: number }

const tenantsState = () => useState<{ loaded: boolean; platform: boolean; current: string; tenants: AdminTenant[] }>('admin-tenants', () => ({
  loaded: false,
  platform: false,
  current: '',
  tenants: [],
}))

/** Tenants the signed-in admin can manage, fetched once per page load. */
export const useAdminTenants = () => {
  const state = tenantsState()
  const { get } = useAdminApi()
  const load = async (force = false) => {
    if (state.value.loaded && !force) return state.value
    const data = await get<{ platform: boolean; current_tenant_id: string; tenants: AdminTenant[] }>('/admin/tenants')
    state.value = { loaded: true, platform: data.platform, current: data.current_tenant_id, tenants: data.tenants || [] }
    return state.value
  }
  return { state, load }
}

/** Formats unix seconds for tables; '—' when missing. */
export const formatAdminTime = (seconds: number | null | undefined) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleString() : '—'
