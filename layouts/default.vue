<template>
  <div class="app-layout">
    <header class="top-header">
      <div class="header-left">
        <svg class="google-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <span class="brand-name">Identity Hub</span>
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
