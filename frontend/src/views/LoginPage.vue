<template>
  <div class="login-page">
    <!-- 未登录：登录表单 -->
    <div v-if="!auth.isLoggedIn" class="login-card">
      <div class="login-title">
        <el-icon :size="36" color="#409EFF"><Connection /></el-icon>
        <h2>现场检测数据接入</h2>
        <p>登录以访问任务/检测点/填报数据</p>
      </div>

      <el-alert
        v-if="route.query.reason === 'token_expired'"
        title="登录已过期，请重新登录"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="onSubmit"
      >
        <el-form-item label="账号" prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入账号"
            :prefix-icon="User"
            clearable
            autocomplete="username"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            show-password
            autocomplete="current-password"
            @keyup.enter="onSubmit"
          />
        </el-form-item>

        <el-alert
          v-if="errorMsg"
          :title="errorMsg"
          type="error"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        />

        <el-button
          type="primary"
          :loading="loading"
          style="width: 100%"
          size="large"
          @click="onSubmit"
        >
          登录
        </el-button>
      </el-form>

      <div class="login-tips">
        💡 测试账号请向管理员索取。后端地址：<code>https://192.168.20.40:3000</code>
      </div>
    </div>

    <!-- 已登录：门户页（跳转两个功能页面） -->
    <div v-else class="portal-card">
      <div class="portal-header">
        <el-avatar :size="56" class="portal-avatar">
          <el-icon :size="32"><User /></el-icon>
        </el-avatar>
        <h2>欢迎，{{ auth.username }}</h2>
        <p>选择一个功能模块进入</p>
      </div>

      <div class="portal-grid">
        <div class="portal-tile" @click="goTo('/map')">
          <div class="portal-tile-icon" style="background: #ecf5ff; color: #409EFF">
            <el-icon :size="40"><MapLocation /></el-icon>
          </div>
          <div class="portal-tile-title">管网地图</div>
          <div class="portal-tile-desc">燃气管线 / 调压箱 / 引入口 GIS 总览</div>
        </div>

        <div class="portal-tile" @click="goTo('/field-tasks')">
          <div class="portal-tile-icon" style="background: #f0f9eb; color: #67c23a">
            <el-icon :size="40"><Connection /></el-icon>
          </div>
          <div class="portal-tile-title">现场检测任务</div>
          <div class="portal-tile-desc">任务 / 检测点 / 填报 / 照片</div>
        </div>

        <div class="portal-tile" @click="goTo('/zhiwen')">
          <div class="portal-tile-icon" style="background: #fdf6ec; color: #e6a23c">
            <el-icon :size="40"><ChatDotRound /></el-icon>
          </div>
          <div class="portal-tile-title">智问</div>
          <div class="portal-tile-desc">自然语言查询数据</div>
        </div>

        <div class="portal-tile" @click="goTo('/dashboard')">
          <div class="portal-tile-icon" style="background: #fef0f0; color: #f56c6c">
            <el-icon :size="40"><DataAnalysis /></el-icon>
          </div>
          <div class="portal-tile-title">进度看板</div>
          <div class="portal-tile-desc">腐控单元完成情况</div>
        </div>
      </div>

      <div class="portal-footer">
        <el-button type="danger" plain @click="onLogout">
          <el-icon><SwitchButton /></el-icon>
          退出登录
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  User, Lock, Connection, MapLocation, ChatDotRound,
  DataAnalysis, SwitchButton,
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref<FormInstance | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function onSubmit() {
  errorMsg.value = ''
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await auth.login(form.username.trim(), form.password)
    ElMessage.success(`欢迎回来，${auth.username}`)
    // 不跳转，停在 /login 展示门户页（已登录模式）
  } catch (e: any) {
    errorMsg.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}

function goTo(path: string) {
  router.push(path)
}

function onLogout() {
  auth.logout()
  ElMessage.success('已退出')
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
}

/* ===== 登录卡片 ===== */
.login-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 12px;
  padding: 36px 32px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
}
.login-title {
  text-align: center;
  margin-bottom: 24px;
}
.login-title h2 {
  margin: 12px 0 4px;
  font-size: 22px;
  color: #303133;
}
.login-title p {
  margin: 0;
  color: #909399;
  font-size: 13px;
}
.login-tips {
  margin-top: 18px;
  font-size: 12px;
  color: #909399;
  text-align: center;
  line-height: 1.6;
}
.login-tips code {
  background: #f5f7fa;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  color: #606266;
}

/* ===== 已登录门户页 ===== */
.portal-card {
  width: 100%;
  max-width: 720px;
  background: #fff;
  border-radius: 16px;
  padding: 40px 48px;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.2);
}
.portal-header {
  text-align: center;
  margin-bottom: 32px;
}
.portal-avatar {
  background: #409EFF;
  margin-bottom: 12px;
}
.portal-header h2 {
  margin: 0 0 4px;
  font-size: 22px;
  color: #303133;
}
.portal-header p {
  margin: 0;
  color: #909399;
  font-size: 13px;
}
.portal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
.portal-tile {
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 20px 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: all 0.2s;
}
.portal-tile:hover {
  border-color: #409eff;
  background: #f0f7ff;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(64, 158, 255, 0.15);
}
.portal-tile-icon {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.portal-tile-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}
.portal-tile-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}
.portal-footer {
  text-align: center;
  padding-top: 8px;
  border-top: 1px solid #ebeef5;
}

@media (max-width: 600px) {
  .portal-card { padding: 28px 20px; }
  .portal-grid { grid-template-columns: 1fr; }
}
</style>
