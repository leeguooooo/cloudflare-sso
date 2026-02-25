<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">ID</div>
        <span class="brand-name">Identity Hub</span>
      </div>
      <nav class="sidebar-nav">
        <NuxtLink to="/portal" class="nav-item" active-class="active">
          Portal
        </NuxtLink>
        <NuxtLink to="/admin" class="nav-item" active-class="active">
          Admin Home
        </NuxtLink>
        <NuxtLink to="/admin/access" class="nav-item" active-class="active">
          Access Control
        </NuxtLink>
        <NuxtLink to="/admin/apps" class="nav-item" active-class="active">
          Applications
        </NuxtLink>
        <NuxtLink to="/admin/billing" class="nav-item" active-class="active">
          Billing
        </NuxtLink>
      </nav>
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="avatar">U</div>
          <div class="user-info">
            <span class="name">Workspace</span>
            <span class="role">SSO Platform</span>
          </div>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <header class="top-header">
        <h1 class="page-title">{{ pageTitle }}</h1>
        <div class="header-actions">
          <NuxtLink to="/login" class="btn-ghost">Login</NuxtLink>
          <NuxtLink to="/" class="btn-ghost">Home</NuxtLink>
        </div>
      </header>
      <div class="content-area">
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()

const pageTitle = computed(() => {
  if (route.path.startsWith('/admin/access')) return 'Admin - Access Control'
  if (route.path.startsWith('/admin/apps')) return 'Admin - Applications'
  if (route.path.startsWith('/admin/billing')) return 'Admin - Billing'
  if (route.path.startsWith('/admin')) return 'Admin Console'
  if (route.path.startsWith('/portal')) return 'User Portal'
  return 'Identity Platform'
})
</script>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  background-color: var(--color-neutral-50);
}

.sidebar {
  width: 260px;
  background-color: white;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  position: fixed;
  height: 100vh;
  left: 0;
  top: 0;
}

.sidebar-header {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 1.5rem;
  border-bottom: 1px solid var(--color-border);
  gap: 0.75rem;
}

.logo {
  width: 32px;
  height: 32px;
  background-color: var(--color-primary-600);
  color: white;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.875rem;
}

.brand-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.sidebar-nav {
  padding: 1.5rem 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  transition: all 0.2s;
}

.nav-item:hover {
  background-color: var(--color-neutral-100);
  color: var(--color-text-primary);
}

.nav-item.active {
  background-color: var(--color-primary-50);
  color: var(--color-primary-700);
}

.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid var(--color-border);
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar {
  width: 36px;
  height: 36px;
  background-color: var(--color-neutral-200);
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.user-info {
  display: flex;
  flex-direction: column;
}

.name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.role {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.main-content {
  flex: 1;
  margin-left: 260px;
  display: flex;
  flex-direction: column;
}

.top-header {
  height: 64px;
  background-color: white;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
}

.page-title {
  font-size: 1.125rem;
  color: var(--color-text-primary);
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.btn-ghost {
  border: 1px solid var(--color-border);
  background: white;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  padding: 0.5rem;
  border-radius: var(--radius-md);
}

.btn-ghost:hover {
  background-color: var(--color-neutral-100);
  color: var(--color-text-primary);
}

.content-area {
  padding: 2rem;
  flex: 1;
}
</style>
