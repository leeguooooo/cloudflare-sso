export default defineNuxtRouteMiddleware((to) => {
  const protectedPath = to.path === '/account' || to.path.startsWith('/admin')
  if (!protectedPath || !process.client) return

  const token = localStorage.getItem('sso_access_token')
  if (token) return

  return navigateTo({
    path: '/login',
    query: {
      continue: to.fullPath,
    },
  })
})
