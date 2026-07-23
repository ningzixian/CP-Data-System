<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useCpStore } from '@/stores/cp'
import { applyTheme, getSavedTheme, type ThemeMode } from '@/utils/theme'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const store = useCpStore()
const auth = useAuthStore()
const appearanceRef = ref<HTMLElement | null>(null)
const appearanceOpen = ref(false)
const theme = ref<ThemeMode>(getSavedTheme())

/**
 * 浮动快捷按钮（FAB）：在所有功能页右下角显示，点一下跳到 /field-tasks
 *  - 在登录页隐藏（避免视觉干扰）
 */
const showFab = computed(() => route.path !== '/login')

function goFieldTasks() {
  router.push('/field-tasks')
}

function selectTheme(next: ThemeMode) {
  theme.value = next
  applyTheme(next)
  appearanceOpen.value = false
}

function closeAppearanceOnOutsideClick(event: MouseEvent) {
  if (!appearanceRef.value?.contains(event.target as Node)) appearanceOpen.value = false
}

onMounted(async () => {
  document.addEventListener('click', closeAppearanceOnOutsideClick)
  await store.loadAll()
  // 加载完前端数据后，再把现场检测后端的数据合并进来
  //  - 失败不影响其他功能
  //  - 用户已登录才同步（避免登录页空跑）
  if (auth.isLoggedIn) {
    const r = await store.syncFromField()
    console.log('[App] 现场检测同步完成:', r)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeAppearanceOnOutsideClick)
})
</script>

<template>
  <div class="app-header">
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
  </div>

  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>

  <!--
    全局浮动快捷按钮（FAB）：任意功能页右下角，点一下跳到 /field-tasks
    - 只在 auth.isLoggedIn 为 true 时显示（避免登录页干扰）
    - 当前页是 field-tasks 时隐藏（已经在目标页）
  -->
  <Transition name="fab-pop">
    <button
      v-if="showFab && auth.isLoggedIn && route.name !== 'field-tasks'"
      class="fab-jump-to-field"
      title="跳到现场检测任务"
      @click="goFieldTasks"
    >
      <span class="fab-icon">🔌</span>
      <span class="fab-label">现场检测</span>
    </button>
  </Transition>
</template>

<style>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ===== 全局浮动快捷按钮（FAB） ===== */
.fab-jump-to-field {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 20px 0 16px;
  border: 0;
  border-radius: 24px;
  background: linear-gradient(135deg, #845ec2 0%, #d65db1 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(132, 94, 194, 0.4);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.fab-jump-to-field:hover {
  transform: translateY(-3px) scale(1.03);
  box-shadow: 0 10px 28px rgba(132, 94, 194, 0.55);
}
.fab-jump-to-field:active {
  transform: translateY(0) scale(0.98);
}
.fab-icon {
  font-size: 22px;
  line-height: 1;
}

/* FAB 进出动画 */
.fab-pop-enter-active {
  animation: fab-in 0.28s ease-out;
}
.fab-pop-leave-active {
  animation: fab-in 0.18s ease-in reverse;
}
@keyframes fab-in {
  0% { transform: translateY(20px) scale(0.85); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
</style>
