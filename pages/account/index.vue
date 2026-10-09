<template>
  <div class="account-shell">
    <header class="topbar">
      <div class="brand">leeguoo 账号</div>
      <div class="top-actions">
        <NuxtLink to="/help">
          <UiButton unstyled type="button" class="icon-btn" aria-label="help">?</UiButton>
        </NuxtLink>
        <div class="apps-wrap" ref="appsWrapRef">
          <UiButton
            v-if="isAdmin"
            unstyled
            type="button"
            class="icon-btn"
            aria-label="apps"
            @click="toggleAppsMenu"
          >
            ⋮
          </UiButton>
          <div v-if="appsOpen && isAdmin" class="apps-menu">
            <NuxtLink to="/portal" @click="appsOpen = false">用户门户</NuxtLink>
            <NuxtLink to="/admin" @click="appsOpen = false">管理后台</NuxtLink>
            <NuxtLink to="/admin/users" @click="appsOpen = false">用户管理</NuxtLink>
            <NuxtLink to="/admin/apps" @click="appsOpen = false">应用管理</NuxtLink>
            <NuxtLink to="/admin/billing" @click="appsOpen = false">订阅管理</NuxtLink>
          </div>
        </div>
        <div class="mini-avatar">
          <img
            v-if="center?.profile.avatar_url"
            :src="center?.profile.avatar_url"
            :alt="`${displayName} avatar`"
            class="mini-avatar-image"
          />
          <span v-else>{{ initials }}</span>
        </div>
      </div>
    </header>

    <div v-if="loading" class="state-text">正在加载账户信息...</div>
    <div v-else-if="error" class="state-text error">{{ error }}</div>

    <div v-else class="body-wrap">
      <aside class="left-nav">
        <UiButton
          v-for="item in navItems"
          :key="item.key"
          unstyled
          type="button"
          class="nav-pill"
          :class="{ active: activeNav === item.key }"
          @click="goSection(item.key)"
        >
          <span class="pill-icon" :style="{ backgroundColor: item.color }">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </UiButton>
      </aside>

      <main class="center-panel">
        <div class="profile-block fade-in">
          <div class="hero-avatar">
            <img
              v-if="center?.profile.avatar_url"
              :src="center?.profile.avatar_url"
              :alt="`${displayName} avatar`"
              class="hero-avatar-image"
            />
            <span v-else>{{ initials }}</span>
          </div>
          <h1>{{ displayName }}</h1>
          <p>{{ center?.profile.email || '未设置邮箱' }}</p>
        </div>

        <form class="search-wrap fade-in delay-1" @submit.prevent="runSearch">
          <span class="search-icon">⌕</span>
          <input
            v-model="searchText"
            class="search-input-field"
            placeholder="搜索账号设置（如：密码、设备、订阅）"
          />
          <UiButton unstyled type="submit" class="search-submit">搜索</UiButton>
        </form>

        <div v-if="searchText.trim()" class="search-results">
          <UiButton
            v-for="target in searchResults"
            :key="target.id"
            unstyled
            type="button"
            class="search-result-btn"
            @click="goToTarget(target)"
          >
            {{ target.label }}
            <small>{{ target.group }}</small>
          </UiButton>
          <p v-if="!searchResults.length" class="search-empty">未找到匹配项</p>
        </div>

        <div class="quick-actions fade-in delay-2">
          <UiButton
            unstyled
            type="button"
            v-for="action in quickActions"
            :key="action.label"
            class="chip"
            @click="goSection(action.section, action.panel)"
          >
            {{ action.label }}
          </UiButton>
        </div>

        <UiCard class="summary-card fade-in delay-3">
          <h2>{{ sectionTitle }}</h2>
          <p class="summary-desc">{{ sectionDesc }}</p>

          <AccountHomeSection v-if="activeNav === 'home'" />

          <AccountProfileSection v-else-if="activeNav === 'profile'" />

          <AccountSecuritySection v-else-if="activeNav === 'security'" />

          <AccountPasswordSection v-else-if="activeNav === 'password'" />

          <AccountLinkedSection v-else-if="activeNav === 'linked'" />

          <AccountPrivacySection v-else-if="activeNav === 'privacy'" />

          <AccountShareSection v-else-if="activeNav === 'share'" />

          <AccountBillingSection v-else-if="activeNav === 'billing'" />
        </UiCard>

        <p v-if="notice" class="notice-text">{{ notice }}</p>

        <p class="privacy-copy">
          只有你本人可以查看你的设置。你可以在这里统一管理登录、安全、应用授权与订阅权益。
        </p>
      </main>
    </div>

    <footer class="bottom-links">
      <NuxtLink to="/privacy">隐私权</NuxtLink>
      <NuxtLink to="/terms">条款</NuxtLink>
      <NuxtLink to="/help">帮助</NuxtLink>
      <NuxtLink to="/about">关于</NuxtLink>
      <UiButton unstyled type="button" class="logout-btn" @click="logout">退出登录</UiButton>
    </footer>
  </div>
</template>

<script setup lang="ts">
import '~/assets/css/account-center.css'

definePageMeta({
  layout: false,
})

const {
  loading,
  error,
  notice,
  searchText,
  appsOpen,
  appsWrapRef,
  center,
  navItems,
  quickActions,
  activeNav,
  displayName,
  initials,
  isAdmin,
  sectionTitle,
  sectionDesc,
  searchResults,
  goSection,
  goToTarget,
  runSearch,
  toggleAppsMenu,
  logout,
} = provideAccountCenter()
</script>
