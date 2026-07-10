import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/map' },
  { path: '/map', name: 'map', component: () => import('@/views/MapPage.vue'), meta: { title: '地图视图' } },
  { path: '/survey', name: 'survey', component: () => import('@/views/SurveyPage.vue'), meta: { title: '管线勘测' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardPage.vue'), meta: { title: '进度看板' } },
  { path: '/manage', name: 'manage', component: () => import('@/views/ManagePage.vue'), meta: { title: '数据管理' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})