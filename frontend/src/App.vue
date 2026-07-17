<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCpStore } from '@/stores/cp'

const router = useRouter()
const store = useCpStore()

onMounted(async () => {
  await store.loadAll()
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
      数据看板
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'manage' }" @click="router.push('/manage')">
      数据管理
    </div>
    <div class="nav-btn" :class="{ active: router.currentRoute.value.name === 'zhiwen' }" @click="router.push('/zhiwen')">
      🧠 智问
    </div>
  </div>
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
</template>

<style>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>