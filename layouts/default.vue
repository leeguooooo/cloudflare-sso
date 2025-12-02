<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">CF</div>
        <span class="brand-name">SSO Admin</span>
      </div>
      <nav class="sidebar-nav">
        <NuxtLink to="/" class="nav-item" active-class="active">
          Dashboard
        </NuxtLink>
        <NuxtLink to="/apps" class="nav-item" active-class="active">
          Applications
        </NuxtLink>
        <NuxtLink to="/users" class="nav-item" active-class="active">
          Users
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-item" active-class="active">
          Settings
        </NuxtLink>
      </nav>
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="avatar">U</div>
          <div class="user-info">
            <span class="name">Admin User</span>
            <span class="role">Administrator</span>
          </div>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <header class="top-header">
        <h1 class="page-title">Dashboard</h1>
        <div class="header-actions">
          <button class="btn-ghost">Help</button>
          <button class="btn-ghost">Logout</button>
        </div>
      </header>
      <div class="content-area">
        <slot />
      </div>
    </main>
  </div>
</template>

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
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
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
