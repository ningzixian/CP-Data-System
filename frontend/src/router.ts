import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * 路由表：所有功能页面都要求登录（refresh 后强制重新登录）
 *  - 只有 /login 不需要
 *  - 其他任何路径（包括 / /map /zhiwen 等）都要 token
 */
const routes = [
  { path: '/', redirect: '/map' },
  { path: '/map', name: 'map', component: () => import('@/views/MapPage.vue'), meta: { title: '地图视图', requiresAuth: true } },
  { path: '/survey', name: 'survey', component: () => import('@/views/SurveyPage.vue'), meta: { title: '管线勘测', requiresAuth: true } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardPage.vue'), meta: { title: '进度看板', requiresAuth: true } },
  { path: '/manage', name: 'manage', component: () => import('@/views/ManagePage.vue'), meta: { title: '数据管理', requiresAuth: true } },
  { path: '/zhiwen', name: 'zhiwen', component: () => import('@/views/ZhiwenPage.vue'), meta: { title: '智问', requiresAuth: true } },
  { path: '/field-tasks', name: 'field-tasks', component: () => import('@/views/FieldTasksPage.vue'), meta: { title: '现场检测任务', requiresAuth: true } },
  { path: '/login', name: 'login', component: () => import('@/views/LoginPage.vue'), meta: { title: '登录' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/**
 * 全局导航守卫
 * - 需要登录的页面：未登录跳 /login（带 redirect）
 * - 已登录访问 /login：允许停留（按用户需求"登录后留在 /login"）
 * - token 只在内存中（不持久化），刷新后必然跳登录页
 */
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})
