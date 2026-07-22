<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCpStore } from '@/stores/cp'
import { useAuthStore } from '@/stores/auth'
import { applyTheme, getSavedTheme, type ThemeMode } from '@/utils/theme'

const router = useRouter()
const store = useCpStore()
const auth = useAuthStore()
const appearanceRef = ref<HTMLElement | null>(null)
const appearanceOpen = ref(false)
const theme = ref<ThemeMode>(getSavedTheme())

function selectTheme(next: ThemeMode) {
  theme.value = next
  applyTheme(next)
  appearanceOpen.value = false
}

function closeAppearanceOnOutsideClick(event: MouseEvent) {
  if (!appearanceRef.value?.contains(event.target as Node)) appearanceOpen.value = false
}

function logout() {
  auth.logout()
  router.replace('/login')
}

function handleExpiredAuth() {
  auth.logout()
}

watch(
  () => router.currentRoute.value.name,
  (routeName) => {
    if (routeName !== 'login' && auth.isAuthenticated) void store.loadAll()
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener('click', closeAppearanceOnOutsideClick)
  window.addEventListener('auth:expired', handleExpiredAuth)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeAppearanceOnOutsideClick)
  window.removeEventListener('auth:expired', handleExpiredAuth)
})
</script>

<template>
  <div v-if="router.currentRoute.value.name !== 'login'" class="app-header">
    <div class="logo">
      <span>🛡️</span>
      <span>阴极保护数据管理系统</span>
      <small>第一阶段：绝缘方案-现状检测</small>
    </div>
    <div class="spacer"></div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'map' }" @click="router.push('/map')">
      地图视图
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'survey' }" @click="router.push('/survey')">
      管线勘测
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'dashboard' }" @click="router.push('/dashboard')">
      进度看板
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'manage' }" @click="router.push('/manage')">
      数据管理
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'zhiwen' }" @click="router.push('/zhiwen')">
      🧠 智问
    </div>
    <div ref="appearanceRef" class="appearance-control">
      <button
        type="button"
        class="appearance-trigger"
        :class="{ active: appearanceOpen }"
        :aria-expanded="appearanceOpen"
        aria-haspopup="menu"
        @click.stop="appearanceOpen = !appearanceOpen"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 9 9c0-.7-.08-1.38-.23-2.03A7 7 0 0 1 12 3Z"/>
        </svg>
        <span>外观</span>
        <span class="appearance-caret">▾</span>
      </button>
      <Transition name="appearance-pop">
        <div v-if="appearanceOpen" class="appearance-menu" role="menu">
          <button type="button" :class="{ selected: theme === 'light' }" role="menuitemradio" :aria-checked="theme === 'light'" @click="selectTheme('light')">
            <span class="appearance-option-icon is-light">☀</span>
            <span class="appearance-option-copy"><strong>浅色模式</strong><small>明亮、清晰的默认外观</small></span>
            <span v-if="theme === 'light'" class="appearance-check">✓</span>
          </button>
          <button type="button" :class="{ selected: theme === 'dark' }" role="menuitemradio" :aria-checked="theme === 'dark'" @click="selectTheme('dark')">
            <span class="appearance-option-icon is-dark">☾</span>
            <span class="appearance-option-copy"><strong>深色模式</strong><small>低亮度的深蓝夜间外观</small></span>
            <span v-if="theme === 'dark'" class="appearance-check">✓</span>
          </button>
        </div>
      </Transition>
    </div>
    <button class="logout-button" type="button" title="退出当前账号" @click="logout">
      <span class="logout-user">{{ auth.username || '当前账号' }}</span>
      <span>退出</span>
    </button>
  </div>
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <KeepAlive :include="['MapPage', 'SurveyPage']">
        <component :is="Component" />
      </KeepAlive>
    </transition>
  </router-view>
</template>

<style>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
