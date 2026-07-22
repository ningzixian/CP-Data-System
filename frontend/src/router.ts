import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/map' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginPage.vue'), meta: { title: '登录', public: true } },
  { path: '/map', name: 'map', component: () => import('@/views/MapPage.vue'), meta: { title: '地图视图' } },
  { path: '/survey', name: 'survey', component: () => import('@/views/SurveyPage.vue'), meta: { title: '管线勘测' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardPage.vue'), meta: { title: '进度看板' } },
  { path: '/manage', name: 'manage', component: () => import('@/views/ManagePage.vue'), meta: { title: '数据管理' } },
  { path: '/zhiwen', name: 'zhiwen', component: () => import('@/views/ZhiwenPage.vue'), meta: { title: '智问' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  const hasToken = Boolean(window.localStorage.getItem('cp-data-system-token'))
  if (!to.meta.public && !hasToken) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && hasToken) return { path: '/map' }
  return true
})

router.afterEach((to) => {
  document.title = `${String(to.meta.title || '系统')} · 阴极保护数据管理系统`
})
