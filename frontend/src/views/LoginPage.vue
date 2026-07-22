<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Hide, Lock, User, View } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const passwordInput = ref<HTMLInputElement>()
const loading = ref(false)
const showPassword = ref(false)
const rememberCredentials = ref(false)
const REMEMBERED_CREDENTIALS_KEY = 'cp-data-system-remembered-credentials'

function readRememberedCredentials() {
  try {
    const saved = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY)
    if (!saved) return { username: '', password: '' }
    const parsed = JSON.parse(saved) as { username?: unknown; password?: unknown }
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
      return { username: '', password: '' }
    }
    rememberCredentials.value = true
    return { username: parsed.username, password: parsed.password }
  } catch {
    window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY)
    return { username: '', password: '' }
  }
}

const form = reactive(readRememberedCredentials())

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const redirectPath = computed(() => {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/map'
  return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/map'
})

watch(rememberCredentials, (checked) => {
  if (!checked) window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY)
})

async function submit() {
  if (!formRef.value || loading.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await auth.login(form.username, form.password)
    if (rememberCredentials.value) {
      window.localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({
        username: form.username.trim(),
        password: form.password,
      }))
    } else {
      window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY)
    }
    ElMessage.success('登录成功')
    await router.replace(redirectPath.value)
  } catch (error: any) {
    const status = error?.response?.status
    const serverMessage = error?.response?.data?.error
    if (status === 401) ElMessage.error('用户名或密码错误')
    else if (serverMessage) ElMessage.error(serverMessage)
    else ElMessage.error('无法连接到服务器，请检查网络后重试')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (auth.isAuthenticated) {
    await router.replace(redirectPath.value)
    return
  }
  if (form.username) {
    await nextTick()
    passwordInput.value?.focus()
  }
})
</script>

<template>
  <main class="login-page">
    <div class="login-grid" aria-hidden="true"></div>
    <div class="login-orb login-orb-one" aria-hidden="true"></div>
    <div class="login-orb login-orb-two" aria-hidden="true"></div>

    <section class="login-intro">
      <div class="login-brand-mark">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path d="M8 29c6-10 11-15 19-15 6 0 9 3 13 8" />
          <path d="M8 36c7-8 12-11 19-11 5 0 9 2 13 6" />
          <circle cx="27" cy="14" r="3" />
        </svg>
      </div>
      <p class="login-kicker">PIPELINE INTEGRITY PLATFORM</p>
      <h1>阴极保护数据<br />管理系统</h1>
      <p class="login-description">汇集现场检测、管网状态与分析报告，让每一条管线的数据清晰可追溯。</p>
      <div class="login-status">
        <span></span>
        <div><strong>内部业务系统</strong><small>请使用授权账号登录访问</small></div>
      </div>
    </section>

    <section class="login-card-wrap">
      <div class="login-card">
        <header>
          <span class="login-card-badge">安全访问</span>
          <h2>欢迎登录</h2>
          <p>请输入您的系统账号和密码</p>
        </header>

        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" :prefix-icon="User" size="large" autocomplete="username" placeholder="请输入用户名" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input
              ref="passwordInput"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              :prefix-icon="Lock"
              size="large"
              autocomplete="current-password"
              placeholder="请输入密码"
            >
              <template #suffix>
                <button class="password-toggle" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
                  <el-icon :size="18" aria-hidden="true">
                    <Hide v-if="showPassword" />
                    <View v-else />
                  </el-icon>
                </button>
              </template>
            </el-input>
          </el-form-item>
          <el-button class="login-submit" type="primary" size="large" :loading="loading" @click="submit">
            {{ loading ? '正在验证…' : '登录系统' }}
          </el-button>
        </el-form>

        <footer>
          <el-checkbox v-model="rememberCredentials">记住用户名和密码</el-checkbox>
        </footer>
      </div>
      <p class="login-copyright">管线现状检测 · 数据仅供授权人员使用</p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100%;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(360px, 1.08fr) minmax(420px, 0.92fr);
  color: #fff;
  background: linear-gradient(145deg, #071425 0%, #0a2440 48%, #0d3154 100%);
}
.login-grid { position: absolute; inset: 0; opacity: .14; background-image: linear-gradient(rgba(91,167,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(91,167,255,.16) 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(90deg, #000, transparent 82%); }
.login-orb { position: absolute; border-radius: 50%; filter: blur(2px); pointer-events: none; }
.login-orb-one { width: 520px; height: 520px; left: -190px; bottom: -220px; background: radial-gradient(circle, rgba(25,148,213,.3), transparent 68%); }
.login-orb-two { width: 360px; height: 360px; left: 38%; top: -210px; background: radial-gradient(circle, rgba(55,130,214,.22), transparent 70%); }
.login-intro { position: relative; z-index: 1; align-self: center; max-width: 650px; padding: 7vw 6vw 7vw 9vw; }
.login-brand-mark { width: 58px; height: 58px; display: grid; place-items: center; margin-bottom: 42px; border: 1px solid rgba(116,190,255,.42); border-radius: 16px; background: rgba(33,112,170,.22); box-shadow: inset 0 0 22px rgba(92,181,255,.08); }
.login-brand-mark svg { width: 38px; fill: none; stroke: #72c6ff; stroke-width: 2.6; stroke-linecap: round; }
.login-kicker { margin: 0 0 15px; color: #6fbbef; font-size: 12px; font-weight: 700; letter-spacing: .22em; }
.login-intro h1 { margin: 0; font-size: clamp(42px, 4vw, 68px); line-height: 1.14; letter-spacing: -.04em; font-weight: 720; }
.login-description { max-width: 520px; margin: 28px 0 46px; color: rgba(221,236,249,.7); font-size: 16px; line-height: 1.9; }
.login-status { display: inline-flex; gap: 13px; align-items: center; padding: 13px 18px; border: 1px solid rgba(126,183,226,.2); border-radius: 12px; background: rgba(7,27,47,.38); }
.login-status > span { width: 9px; height: 9px; border-radius: 50%; background: #4dd6a5; box-shadow: 0 0 0 6px rgba(77,214,165,.1); }
.login-status div { display: grid; gap: 3px; }
.login-status strong { font-size: 13px; font-weight: 600; }
.login-status small { color: rgba(213,231,246,.52); font-size: 11px; }
.login-card-wrap { position: relative; z-index: 1; display: grid; place-content: center; padding: 48px; background: rgba(244,248,252,.985); color: #182a3d; box-shadow: -24px 0 70px rgba(0,0,0,.16); }
.login-card { width: min(420px, 100%); padding: 42px 42px 28px; border: 1px solid #e4ebf2; border-radius: 22px; background: #fff; box-shadow: 0 22px 65px rgba(31,58,95,.12); }
.login-card header { margin-bottom: 30px; }
.login-card-badge { display: inline-block; margin-bottom: 18px; padding: 5px 10px; border-radius: 6px; color: #1478b8; background: #e8f5fd; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.login-card h2 { margin: 0 0 9px; color: #172a3c; font-size: 30px; letter-spacing: -.03em; }
.login-card header p { margin: 0; color: #7b8b9b; font-size: 14px; }
.login-card :deep(.el-form-item) { margin-bottom: 22px; }
.login-card :deep(.el-form-item__label) { padding-bottom: 8px; color: #3f5264; font-size: 13px; font-weight: 600; }
.login-card :deep(.el-input__wrapper) { min-height: 48px; border-radius: 10px; background: #f8fafc; box-shadow: 0 0 0 1px #dbe4ed inset; }
.login-card :deep(.el-input__wrapper.is-focus) { background: #fff; box-shadow: 0 0 0 1px #2388c7 inset, 0 0 0 4px rgba(35,136,199,.09); }
.password-toggle { width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #73889b; cursor: pointer; }
.password-toggle:hover { color: #2388c7; background: #edf6fb; }
.password-toggle:focus-visible { outline: 2px solid rgba(35,136,199,.35); outline-offset: 1px; }
.login-submit { width: 100%; height: 49px; margin-top: 5px; border: 0; border-radius: 10px; background: linear-gradient(135deg, #167fbf, #1267a5); font-weight: 600; box-shadow: 0 9px 20px rgba(18,103,165,.22); }
.login-submit:hover { background: linear-gradient(135deg, #198dcc, #1475b7); }
.login-card footer { display: flex; justify-content: flex-start; align-items: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #edf1f5; }
.login-card footer :deep(.el-checkbox__label) { color: #637689; font-size: 13px; }
.login-card footer :deep(.el-checkbox__input.is-checked + .el-checkbox__label) { color: #2388c7; }
.login-copyright { margin: 24px 0 0; color: #9aa7b3; font-size: 11px; text-align: center; }
@media (max-width: 900px) { .login-page { grid-template-columns: 1fr; } .login-intro { display: none; } .login-card-wrap { min-height: 100vh; padding: 24px; } }
@media (max-width: 520px) { .login-card { padding: 32px 24px 24px; border-radius: 18px; } }
</style>
