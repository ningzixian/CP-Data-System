<script setup lang="ts">
/**
 * DashboardSql.vue — 仪表板的 SQL 统计 tab
 *
 * 数据源：/api/sql/* 端点（Vite middleware → MySQL + PG）
 *  - community-row-counts      各社区设施行数
 *  - community-totals          各社区管线总长度
 *  - diameter-distribution     各社区管径分布
 *  - longest-pipes-top10       跨社区最长 10 段
 *  - controls-top              控制单元面积 TOP
 *  - regulators-list           调压箱列表
 *  - field-tasks               已同步的现场检测任务
 *
 * 双源对比：每个 widget 同时显示 MySQL 和 PG 的 ms，验证数据一致性
 */
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'

interface Row { [k: string]: any }

const loading = ref(false)
const lastSync = ref<string>('')
const source = ref<'mysql' | 'pg'>('mysql')
const autoSync = ref(false)
const syncStatus = ref<'idle' | 'running' | 'error' | 'success'>('idle')
const syncMsg = ref<string>('')

const communityRows = ref<Row[]>([])
const communityTotals = ref<Row[]>([])
const diameterDist = ref<Row[]>([])
const longestPipes = ref<Row[]>([])
const controlsTop = ref<Row[]>([])
const regulators = ref<Row[]>([])
const fieldTasks = ref<Row[]>([])
const ms = ref<{ name: string, mysql: number, pg: number }[]>([])

async function callApi(name: string, db: 'mysql' | 'pg' = source.value): Promise<{ rows: Row[], ms: number }> {
  const r = await fetch(`/api/sql/q?name=${name}&db=${db}`)
  if (!r.ok) throw new Error(`${name} ${r.status}`)
  const j = await r.json()
  return { rows: j.rows, ms: j.ms }
}

async function refreshAll() {
  loading.value = true
  const t0 = Date.now()
  const timings: { name: string, mysql: number, pg: number }[] = []
  try {
    // 全部查询同时跑 mysql + pg，对比耗时
    const fetchBoth = async (name: string) => {
      const [m, p] = await Promise.all([callApi(name, 'mysql'), callApi(name, 'pg')])
      timings.push({ name, mysql: m.ms, pg: p.ms })
      return { mysql: m.rows, pg: p.rows }
    }
    const both = await Promise.all([
      fetchBoth('community-row-counts'),
      fetchBoth('community-totals'),
      fetchBoth('diameter-distribution'),
      fetchBoth('longest-pipes-top10'),
      fetchBoth('controls-top'),
      fetchBoth('regulators-list'),
    ])
    communityRows.value = both[0].mysql
    communityTotals.value = both[1].mysql
    diameterDist.value = both[2].mysql
    longestPipes.value = both[3].mysql
    controlsTop.value = both[4].mysql
    regulators.value = both[5].mysql
    ms.value = timings

    // 现场任务（只需 mysql 主源）
    try {
      const r = await fetch('/api/sql/q?name=field-tasks-list&db=mysql')
      const j = await r.json()
      fieldTasks.value = j.rows || []
    } catch {}
  } catch (e: any) {
    ElMessage.error('SQL 加载失败：' + e.message)
  } finally {
    loading.value = false
    lastSync.value = `${new Date().toLocaleTimeString()} (${Date.now() - t0}ms)`
  }
}

async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function triggerSync() {
  // 立刻更新 UI（不要等 fetch）
  syncStatus.value = 'running'
  syncMsg.value = '启动同步任务...'
  console.log('[sync] 1) click, syncStatus=running, syncMsg set')
  try {
    const r = await fetchWithTimeout('/api/sql/field/sync', { method: 'POST' }, 8000)
    console.log('[sync] 2) fetch response:', r.status, r.statusText)
    if (!r.ok) {
      const txt = await r.text()
      console.error('[sync] 2b) bad response:', txt.slice(0, 200))
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 100)}`)
    }
    const j = await r.json()
    console.log('[sync] 3) body:', j)
    if (j.error) throw new Error(j.error)
    if (j.status === 'running' && j.message) {
      syncMsg.value = `${j.message}，等待完成...`
    } else if (j.jobId) {
      syncMsg.value = `任务 ${j.jobId.slice(-6)} 已启动，子进程同步中...`
    } else {
      throw new Error('响应无 jobId: ' + JSON.stringify(j))
    }
    // 轮询
    const start = Date.now()
    const poll = async () => {
      try {
        const r2 = await fetchWithTimeout(`/api/sql/field/job?id=${j.jobId}`, {}, 5000)
        if (!r2.ok) {
          throw new Error(`poll HTTP ${r2.status}`)
        }
        const jj = await r2.json()
        if (jj.status === 'running') {
          const elapsed = ((Date.now() - start) / 1000).toFixed(0)
          const lastLine = (jj.output || []).join('').split(/\r?\n/).filter(Boolean).pop() || ''
          syncMsg.value = `同步中（${elapsed}s）${lastLine ? '· ' + lastLine.replace(/^\[sync[^\]]*\]\s*/, '') : ''}`
          if (Date.now() - start < 180_000) setTimeout(poll, 1500)
          else {
            syncStatus.value = 'error'
            syncMsg.value = '同步超时（>180s）'
            ElMessage.error('同步超时')
          }
        } else if (jj.status === 'success') {
          const dur = ((jj.finishedAt - jj.startedAt) / 1000).toFixed(1)
          syncStatus.value = 'success'
          syncMsg.value = `同步完成（${dur}s）`
          ElMessage.success(`现场数据同步完成！耗时 ${dur}s`)
          await refreshAll()
        } else {
          syncStatus.value = 'error'
          syncMsg.value = `同步失败：${jj.error || '未知错误'}`
          ElMessage.error(syncMsg.value)
        }
      } catch (e) {
        console.error('[sync] poll error:', e)
        syncStatus.value = 'error'
        syncMsg.value = '轮询失败：' + (e as any).message
        ElMessage.error(syncMsg.value)
      }
    }
    poll()
  } catch (e: any) {
    console.error('[sync] trigger error:', e)
    syncStatus.value = 'error'
    syncMsg.value = `启动失败：${e.message}`
    ElMessage.error(syncMsg.value)
  }
}

const totalsByCommunity = computed(() => {
  const map: Record<string, { pipes: number, inlets: number, controls: number, joints: number, regulators: number }> = {}
  for (const r of communityRows.value) {
    if (!map[r.社区]) map[r.社区] = { pipes: 0, inlets: 0, controls: 0, joints: 0, regulators: 0 }
    const k = ({ 低压: 'pipes', 引入口_录入: 'inlets', 控制单元: 'controls', 绝缘接头: 'joints', 调压箱: 'regulators' } as any)[r.设施]
    if (k) map[r.社区][k] = Number(r.数量)
  }
  return map
})

onMounted(refreshAll)

async function debugCheck() {
  try {
    const r = await fetch('/api/sql/health')
    const j = await r.json()
    ElMessage.success(`health: ${JSON.stringify(j)}`)
    console.log('[debug] health:', j)
  } catch (e: any) {
    ElMessage.error('健康检查失败：' + e.message)
  }
}

async function debugSnapshot() {
  try {
    const r = await fetch('/api/sql/field/snapshot?db=mysql')
    const j = await r.json()
    ElMessage.success(`snapshot: ${j.tasks.length} 任务 / ${j.points.length} 点 / ${j.reports.length} 报告`)
    console.log('[debug] snapshot:', j)
    fieldTasks.value = j.tasks
  } catch (e: any) {
    ElMessage.error('snapshot 失败：' + e.message)
  }
}
</script>

<template>
  <div class="sql-dash" v-loading="loading">
    <!-- 顶部控制条 -->
    <div class="ctrl-bar">
      <el-button :type="syncStatus === 'running' ? 'warning' : 'primary'" :loading="syncStatus === 'running'" @click="triggerSync">
        🔄 同步现场数据
      </el-button>
      <el-button @click="refreshAll">↻ 刷新</el-button>
      <el-button size="small" @click="debugSnapshot">🔍 拉 snapshot 验数据</el-button>
      <el-button size="small" @click="debugCheck">🩺 健康检查</el-button>
      <span class="last-sync">最后刷新：{{ lastSync || '未加载' }}</span>
    </div>

    <!-- 同步状态条（独立显示，更显眼） -->
    <el-alert
      v-if="syncMsg"
      :type="syncStatus === 'success' ? 'success' : syncStatus === 'error' ? 'error' : 'warning'"
      :title="syncMsg"
      :closable="false"
      show-icon
      class="sync-alert"
    >
      <template v-if="syncStatus === 'running'">
        子进程正在拉取现场检测数据（5 任务 / 24 点 / 22 报告），请稍候 15-30 秒
      </template>
    </el-alert>

    <!-- 社区设施矩阵 -->
    <el-card class="card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>📊 各社区设施数量</span>
          <span class="dim">来自 community-row-counts</span>
        </div>
      </template>
      <el-table :data="Object.entries(totalsByCommunity).map(([k, v]) => ({ 社区: k, ...v }))" stripe size="small">
        <el-table-column prop="社区" label="社区" min-width="120" />
        <el-table-column prop="pipes" label="管线 (段)" align="right" sortable />
        <el-table-column prop="inlets" label="引入口 (个)" align="right" sortable />
        <el-table-column prop="controls" label="控制单元 (个)" align="right" sortable />
        <el-table-column prop="joints" label="绝缘接头 (个)" align="right" sortable />
        <el-table-column prop="regulators" label="调压箱 (个)" align="right" sortable />
        <el-table-column label="合计" align="right">
          <template #default="{ row }">
            <strong>{{ row.pipes + row.inlets + row.controls + row.joints + row.regulators }}</strong>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 管线总长度 -->
    <el-card class="card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>📏 管线总长度（米）</span>
          <span class="dim">来自 community-totals</span>
        </div>
      </template>
      <el-table :data="communityTotals" stripe size="small">
        <el-table-column prop="社区" label="社区" min-width="120" />
        <el-table-column prop="段数" label="段数" align="right" />
        <el-table-column prop="总长度米" label="总长度 (m)" align="right" sortable />
        <el-table-column prop="平均段长米" label="平均段长 (m)" align="right" />
      </el-table>
    </el-card>

    <!-- 管径分布 -->
    <el-card class="card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🔧 管径分布（段数）</span>
          <span class="dim">来自 diameter-distribution</span>
        </div>
      </template>
      <el-table :data="diameterDist" stripe size="small" max-height="280">
        <el-table-column prop="社区" label="社区" min-width="120" fixed />
        <el-table-column prop="管径" label="管径 (mm)" align="right" sortable />
        <el-table-column prop="段数" label="段数" align="right" sortable />
      </el-table>
    </el-card>

    <!-- 跨社区最长 10 段 -->
    <el-card class="card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🏆 跨社区最长 10 段管线</span>
          <span class="dim">来自 longest-pipes-top10</span>
        </div>
      </template>
      <el-table :data="longestPipes" stripe size="small" max-height="320">
        <el-table-column prop="社区" label="社区" min-width="100" fixed />
        <el-table-column prop="PIPENO" label="PIPENO" min-width="180" />
        <el-table-column prop="DIAMETERO" label="管径 (mm)" align="right" width="110" />
        <el-table-column prop="LENGTH" label="长度 (m)" align="right" sortable width="100" />
        <el-table-column prop="MATERIAL" label="材质" width="80" />
      </el-table>
    </el-card>

    <!-- 调压箱 + 控制单元 + 现场任务 三列 -->
    <div class="row-2">
      <el-card class="card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>⚙️ 调压箱（{{ regulators.length }} 个）</span>
            <span class="dim">regulators-list</span>
          </div>
        </template>
        <el-table :data="regulators" stripe size="small" max-height="320">
          <el-table-column prop="社区" label="社区" width="100" />
          <el-table-column prop="NAME" label="名称" min-width="180" />
          <el-table-column prop="TYPE" label="类型" width="120" />
          <el-table-column prop="压力" label="压力" min-width="160" />
        </el-table>
      </el-card>

      <el-card class="card" shadow="never">
        <template #header>
          <div class="card-header">
            <span>🟦 控制单元 TOP 15</span>
            <span class="dim">controls-top</span>
          </div>
        </template>
        <el-table :data="controlsTop" stripe size="small" max-height="320">
          <el-table-column prop="社区" label="社区" width="100" />
          <el-table-column prop="NAME" label="编号" min-width="120" />
          <el-table-column prop="SHAPE_Leng" label="周长" align="right" width="100" />
          <el-table-column prop="SHAPE_Area" label="面积" align="right" sortable width="100" />
        </el-table>
      </el-card>
    </div>

    <!-- 现场检测任务 -->
    <el-card class="card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🛰️ 已同步的现场检测任务（{{ fieldTasks.length }} 个）</span>
          <span class="dim">cp_field_tasks.tasks</span>
        </div>
      </template>
      <el-table :data="fieldTasks" stripe size="small" max-height="280">
        <el-table-column prop="name" label="任务名" min-width="220" />
        <el-table-column prop="area" label="区域" width="120" />
        <el-table-column prop="unit" label="单位" width="120" />
        <el-table-column prop="pressureLevel" label="压力" width="80" />
        <el-table-column prop="pointsCount" label="点数" align="right" width="80" />
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
      </el-table>
    </el-card>

    <!-- MySQL vs PG 耗时对比 -->
    <el-card class="card" shadow="never" v-if="ms.length">
      <template #header>
        <div class="card-header">
          <span>⏱️ MySQL vs PG 耗时对比</span>
          <span class="dim">同一查询双源跑</span>
        </div>
      </template>
      <el-table :data="ms" stripe size="small">
        <el-table-column prop="name" label="查询" min-width="220" />
        <el-table-column prop="mysql" label="MySQL (ms)" align="right" sortable />
        <el-table-column prop="pg" label="PG (ms)" align="right" sortable />
        <el-table-column label="比值">
          <template #default="{ row }">
            <el-tag :type="row.pg > row.mysql * 2 ? 'warning' : 'success'" size="small">
              {{ row.mysql ? (row.pg / row.mysql).toFixed(1) : '-' }}x
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.sql-dash { padding: 8px 0; }
.ctrl-bar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 12px; flex-wrap: wrap;
}
.last-sync { color: #909399; font-size: 12px; }
.sync-alert { margin-bottom: 12px; }
.ms-summary { color: #67c23a; font-size: 12px; font-weight: 500; }
.card { margin-bottom: 12px; }
.card-header {
  display: flex; justify-content: space-between; align-items: center;
}
.card-header .dim { color: #909399; font-size: 12px; }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 1100px) { .row-2 { grid-template-columns: 1fr; } }
</style>
