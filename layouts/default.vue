<template>
  <div class="app-layout">
    <header class="top-header">
      <div class="header-left">
        <UiLogo size="sm" mode="full" />
      </div>
      <div class="header-right">
        <NuxtLink to="/login" class="avatar-circle">U</NuxtLink>
      </div>
    </header>

    <aside class="sidebar">
      <nav class="sidebar-nav">
        <NuxtLink to="/portal" class="nav-item" active-class="active">
          <div class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          Portal
        </NuxtLink>
        <NuxtLink to="/admin" class="nav-item" active-class="active">
          <div class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          Admin Home
        </NuxtLink>
        <NuxtLink to="/admin/access" class="nav-item" active-class="active">
          <div class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          Access Control
        </NuxtLink>
        <NuxtLink to="/admin/apps" class="nav-item" active-class="active">
          <div class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          Applications
        </NuxtLink>
        <NuxtLink to="/admin/billing" class="nav-item" active-class="active">
          <div class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          </div>
          Billing
        </NuxtLink>
      </nav>
    </aside>

    <main class="main-content">
      <div class="content-area">
        <h1 class="page-title">{{ pageTitle }}</h1>
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
  background-color: #ffffff;
  color: #202124;
  font-family: 'Google Sans', 'Roboto', 'Inter', sans-serif;
}

.sidebar {
  width: 280px;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  position: fixed;
  height: 100vh;
  left: 0;
  top: 0;
  padding-top: 64px;
}

.sidebar-nav {
  padding: 8px 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: 48px;
  color: #444746;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  border-radius: 0 24px 24px 0;
  margin-right: 12px;
  transition: background-color 0.2s;
}

.nav-item:hover {
  background-color: #f7f9fc;
}

.nav-item.active {
  background-color: #e8f0fe;
  color: #1a73e8;
}

.nav-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.main-content {
  flex: 1;
  margin-left: 280px;
  display: flex;
  flex-direction: column;
}

.top-header {
  height: 64px;
  background-color: #ffffff;
  border-bottom: 1px solid #dadce0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.google-logo {
  width: 24px;
  height: 24px;
}

.brand-name {
  font-size: 1.375rem;
  font-weight: 400;
  color: #5f6368;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: #1a73e8;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  font-size: 0.875rem;
}

.content-area {
  padding: 104px 48px 48px; /* 64px header + 40px padding */
  max-width: 1200px;
  width: 100%;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 400;
  margin-bottom: 24px;
  color: #1f1f1f;
}
</style>
