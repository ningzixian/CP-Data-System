<template>
  <div class="ft-page">
    <!-- 顶部栏 -->
    <header class="ft-header">
      <div class="ft-header-left">
        <el-button link @click="$router.push('/map')">
          <el-icon><ArrowLeft /></el-icon> 返回地图
        </el-button>
        <span class="ft-title">
          <el-icon><Connection /></el-icon>
          现场检测数据
        </span>
        <el-tag v-if="lastSyncAt" type="success" size="small" effect="plain">
          <el-icon><Refresh /></el-icon>
          {{ lastSyncAt }} 更新
        </el-tag>
        <el-tooltip v-else-if="tasks.error" :content="String(tasks.error.message || tasks.error)" placement="bottom">
          <el-tag type="danger" size="small" effect="plain">
            <el-icon><Warning /></el-icon>
            同步失败（悬停看原因）
          </el-tag>
        </el-tooltip>
        <el-tag v-else-if="tasks.loading" type="info" size="small" effect="plain">
          <el-icon class="is-loading"><Loading /></el-icon>
          同步中…
        </el-tag>
      </div>
      <div class="ft-header-right">
        <span class="ft-user">
          <el-icon><User /></el-icon>
          {{ auth.username }}
        </span>
        <el-button size="small" plain @click="showCreateTask = true">
          <el-icon><Plus /></el-icon> 新建任务
        </el-button>
        <el-button size="small" plain @click="tasks.refresh()">
          <el-icon><Refresh /></el-icon> 手动刷新
        </el-button>
        <el-button size="small" type="danger" plain @click="onLogout">
          <el-icon><SwitchButton /></el-icon> 退出
        </el-button>
      </div>
    </header>

    <div class="ft-body">
      <!-- 左：任务列表 -->
      <aside class="ft-tasks">
        <div class="ft-tasks-header">
          <span>任务列表（{{ (tasks.data || []).length }}）</span>
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜索任务名/区域"
            clearable
            :prefix-icon="Search"
          />
        </div>
        <div v-if="tasks.loading && !tasks.data" class="ft-empty">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中…</span>
        </div>
        <div v-else-if="filteredTasks.length === 0" class="ft-empty">
          <el-empty :description="keyword ? '没有匹配的任务' : '暂无任务，点击右上角新建'" :image-size="60" />
        </div>
        <ul v-else class="ft-task-list">
          <li
            v-for="t in filteredTasks"
            :key="t.id"
            :class="['ft-task-item', { active: selectedTaskId === t.id }]"
            @click="selectTask(t.id)"
          >
            <div class="ft-task-name">{{ t.name }}</div>
            <div class="ft-task-meta">
              <el-tag size="small" effect="plain">{{ t.area }}</el-tag>
              <el-tag size="small" :type="pressureType(t.pressureLevel)" effect="plain">
                {{ pressureLabel(t.pressureLevel) }}
              </el-tag>
              <span class="ft-task-points">
                <el-icon><Location /></el-icon>
                {{ t.pointsCount }} 个点位
              </span>
            </div>
          </li>
        </ul>
      </aside>

      <!-- 中：地图 + 点位列表 -->
      <main class="ft-main">
        <template v-if="selectedTaskId && selectedTask">
          <div class="ft-main-header">
            <h3>{{ selectedTask.name }}</h3>
            <div class="ft-main-meta">
              <span><b>区域：</b>{{ selectedTask.area }}</span>
              <span><b>单元：</b>{{ selectedTask.unit }}</span>
              <span><b>楼栋：</b>{{ selectedTask.buildings.join('、') || '—' }}</span>
              <span><b>压力：</b>{{ pressureLabel(selectedTask.pressureLevel) }}</span>
            </div>
            <div class="ft-main-actions">
              <el-button size="small" type="primary" @click="showAddPoint = true">
                <el-icon><Plus /></el-icon> 添加检测点
              </el-button>
              <el-button size="small" plain @click="onDeleteTask(selectedTask)">
                <el-icon><Delete /></el-icon> 删除任务
              </el-button>
            </div>
          </div>

          <div class="ft-main-content">
            <!-- 地图 -->
            <div class="ft-map-wrap">
              <div ref="mapRef" class="ft-map" />
              <div v-if="mapError" class="ft-map-status ft-map-status--error">
                <el-icon><Warning /></el-icon>
                {{ mapError }}
              </div>
              <div v-else-if="mapLoading" class="ft-map-status">
                <el-icon class="is-loading"><Loading /></el-icon>
                地图加载中…
              </div>
              <div v-else-if="points.data && points.data.length > 0" class="ft-map-badge">
                <span class="dot" />
                共 {{ points.data.length }} 个检测点
              </div>
              <!-- 还原视图按钮：浮在地图右上角，轮询不会动它 -->
              <button
                v-if="mapInitialized && (points.data?.length || 0) > 0"
                class="ft-reset-map"
                title="把地图还原到显示全部点位"
                @click="resetMapView"
              >
                <el-icon :size="16"><FullScreen /></el-icon>
                <span>还原视图</span>
              </button>
            </div>

            <!-- 点位列表 + 填报 -->
            <div class="ft-points">
              <div class="ft-points-header">
                <span>检测点（{{ (points.data || []).length }}）</span>
                <span class="ft-points-tip">每 5 秒自动同步</span>
              </div>
              <div v-if="points.loading && !points.data" class="ft-empty">
                <el-icon class="is-loading"><Loading /></el-icon>
                加载中…
              </div>
              <div v-else-if="(points.data || []).length === 0" class="ft-empty">
                <el-empty description="该任务下暂无检测点" :image-size="60" />
              </div>
              <ul v-else class="ft-point-list">
                <li
                  v-for="p in points.data"
                  :key="p.id"
                  :class="['ft-point-item', { active: selectedPointId === p.id }]"
                  @click="selectPoint(p.id)"
                >
                  <div class="ft-point-seq">#{{ p.seq }}</div>
                  <div class="ft-point-info">
                    <div class="ft-point-loc">{{ p.location || '—' }}</div>
                    <div class="ft-point-tags">
                      <el-tag
                        v-for="dt in p.dataTypes"
                        :key="dt"
                        size="small"
                        effect="plain"
                        type="info"
                      >{{ dt }}</el-tag>
                    </div>
                  </div>
                  <div class="ft-point-coord">
                    {{ p.lng.toFixed(5) }}, {{ p.lat.toFixed(5) }}
                  </div>
                </li>
              </ul>

              <!-- 选中点位 → 填报列表 -->
              <div v-if="selectedPoint" class="ft-reports">
                <div class="ft-reports-header">
                  <el-icon><Document /></el-icon>
                  <span>{{ selectedPoint.location || `点位 #${selectedPoint.seq}` }} 的填报</span>
                  <el-button size="small" type="primary" @click="showAddReport = true">
                    <el-icon><Plus /></el-icon> 新增填报
                  </el-button>
                </div>
                <div v-if="reports.loading && !reports.data" class="ft-empty">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  加载中…
                </div>
                <div v-else-if="(reports.data || []).length === 0" class="ft-empty">
                  <el-empty description="该点位暂无填报" :image-size="50" />
                </div>
                <div v-else class="ft-report-list">
                  <div v-for="r in reports.data" :key="r.id" class="ft-report-card">
                    <div class="ft-report-time">
                      <el-icon><Clock /></el-icon>
                      {{ formatTime(r.createdAt) }}
                    </div>
                    <div v-if="r.items.土壤电阻率" class="ft-report-section">
                      <h5>土壤电阻率</h5>
                      <div>地钎距离：{{ r.items.土壤电阻率.地钎距离 }} m</div>
                      <div>电阻值：{{ r.items.土壤电阻率.电阻值 }} Ω</div>
                      <div>电阻率：{{ r.items.土壤电阻率.电阻率 }} Ω·m</div>
                      <div v-if="r.items.土壤电阻率.photos.length" class="ft-photo-list">
                        <el-image
                          v-for="ph in r.items.土壤电阻率.photos"
                          :key="ph"
                          :src="fieldApi.photoUrl(ph)"
                          :preview-src-list="[fieldApi.photoUrl(ph)]"
                          :initial-index="0"
                          fit="cover"
                          class="ft-photo"
                        />
                      </div>
                    </div>
                    <div v-if="r.items.土壤酸碱值" class="ft-report-section">
                      <h5>土壤酸碱值</h5>
                      <div>pH：{{ r.items.土壤酸碱值.酸碱度 }}</div>
                    </div>
                    <div v-if="r.items.管线探测" class="ft-report-section">
                      <h5>管线探测</h5>
                      <div>RTK 编号：{{ r.items.管线探测.rtkNo }}</div>
                      <div>埋深：{{ r.items.管线探测.埋深 }} m</div>
                      <div>破损点：<el-tag :type="r.items.管线探测.破损点 ? 'danger' : 'success'" size="small">{{ r.items.管线探测.破损点 ? '有' : '无' }}</el-tag></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="ft-main-empty">
          <el-empty description="从左侧选择一个任务查看详情" :image-size="120" />
        </div>
      </main>
    </div>

    <!-- 新建任务对话框 -->
    <el-dialog v-model="showCreateTask" title="新建检测任务" width="480px">
      <el-form :model="newTask" label-width="80px">
        <el-form-item label="任务名" required>
          <el-input v-model="newTask.name" placeholder="如：七里 3 月管线探测" />
        </el-form-item>
        <el-form-item label="区域" required>
          <el-input v-model="newTask.area" placeholder="如：南海家园七里" />
        </el-form-item>
        <el-form-item label="单元" required>
          <el-input v-model="newTask.unit" placeholder="如：FSKZ755853" />
        </el-form-item>
        <el-form-item label="楼栋">
          <el-input
            v-model="newTaskBuildingsStr"
            placeholder="逗号分隔，如：1号楼,2号楼,3号楼"
          />
        </el-form-item>
        <el-form-item label="压力等级" required>
          <el-select v-model="newTask.pressureLevel" style="width: 100%">
            <el-option label="低压 P≤0.01MPa" value="low" />
            <el-option label="中压A 0.2<P≤0.4MPa" value="medA" />
            <el-option label="中压B 0.01<P≤0.2MPa" value="medB" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateTask = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="onCreateTask">创建</el-button>
      </template>
    </el-dialog>

    <!-- 添加检测点对话框 -->
    <el-dialog v-model="showAddPoint" title="添加检测点" width="440px">
      <el-form :model="newPoint" label-width="80px">
        <el-form-item label="位置描述" required>
          <el-input v-model="newPoint.location" placeholder="如：1 号楼东侧 5m" />
        </el-form-item>
        <el-form-item label="经度" required>
          <el-input-number v-model="newPoint.lng" :precision="6" :step="0.0001" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="纬度" required>
          <el-input-number v-model="newPoint.lat" :precision="6" :step="0.0001" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="检测项" required>
          <el-checkbox-group v-model="newPoint.dataTypes">
            <el-checkbox value="位置" />
            <el-checkbox value="土壤电阻率" />
            <el-checkbox value="土壤酸碱值" />
            <el-checkbox value="管线探测" />
            <el-checkbox value="馈电实验" />
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddPoint = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="onCreatePoint">添加</el-button>
      </template>
    </el-dialog>

    <!-- 新增填报对话框 -->
    <el-dialog v-model="showAddReport" title="新增检测填报" width="560px">
      <el-form :model="newReport" label-width="100px">
        <el-form-item label="填报项">
          <el-tabs v-model="newReport.tab">
            <el-tab-pane label="土壤电阻率" name="土壤电阻率">
              <el-form-item label="地钎距离(m)">
                <el-input-number v-model="newReport.地钎距离" :step="0.1" :precision="2" />
              </el-form-item>
              <el-form-item label="电阻值(Ω)">
                <el-input-number v-model="newReport.电阻值" :step="0.1" :precision="2" />
              </el-form-item>
              <el-form-item label="电阻率(Ω·m)">
                <el-input-number v-model="newReport.电阻率" :step="0.1" :precision="2" />
              </el-form-item>
            </el-tab-pane>
            <el-tab-pane label="土壤酸碱值" name="土壤酸碱值">
              <el-form-item label="pH">
                <el-input-number v-model="newReport.酸碱度" :step="0.1" :precision="2" :min="0" :max="14" />
              </el-form-item>
            </el-tab-pane>
            <el-tab-pane label="管线探测" name="管线探测">
              <el-form-item label="RTK 编号">
                <el-input v-model="newReport.rtkNo" />
              </el-form-item>
              <el-form-item label="埋深(m)">
                <el-input-number v-model="newReport.埋深" :step="0.1" :precision="2" />
              </el-form-item>
              <el-form-item label="有破损点">
                <el-switch v-model="newReport.破损点" />
              </el-form-item>
            </el-tab-pane>
          </el-tabs>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddReport = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="onCreateReport">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, reactive, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Connection, Refresh, Warning, User, Plus, SwitchButton,
  Search, Loading, Location, Delete, Document, Clock, FullScreen,
} from '@element-plus/icons-vue'
import { loadAMap } from '@/map/amap-loader'
import { fieldApi, type TaskWithCount, type DetectionPoint, type DetectionReport, type DataType, type PressureLevel } from '@/api/fieldApi'
import { usePolling } from '@/composables/usePolling'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

// ============ 任务列表（5s 轮询）============
// vue-tsc 不识别模板里嵌套对象的 computed 解包，用 ref 包装 + watch 同步
const _tasks = usePolling<TaskWithCount[]>(
  () => fieldApi.listTasks(),
  { interval: 5000, immediate: true },
)
const tasks = reactive({
  data: null as TaskWithCount[] | null,
  loading: false,
  error: null as Error | null,
  refresh: () => _tasks.refresh(),
})
watch(_tasks.data, (v) => { tasks.data = v }, { immediate: true })
watch(_tasks.loading, (v) => { tasks.loading = v }, { immediate: true })
watch(_tasks.error, (v) => { tasks.error = v }, { immediate: true })

const lastSyncAt = ref('')
watch(
  _tasks.data,
  () => { lastSyncAt.value = new Date().toLocaleTimeString() },
)

// ============ 选中任务 ============
const keyword = ref('')
const filteredTasks = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = tasks.data || []
  if (!kw) return list
  return list.filter((t) =>
    t.name.toLowerCase().includes(kw) || t.area.toLowerCase().includes(kw) || t.unit.toLowerCase().includes(kw),
  )
})

const selectedTaskId = ref<string | null>(null)
const selectedTask = computed(() => (tasks.data || []).find((t) => t.id === selectedTaskId.value) || null)

function selectTask(id: string) {
  selectedTaskId.value = id
  selectedPointId.value = null
}

// ============ 点位列表（任务切换时拉）============
const _points = usePolling<DetectionPoint[]>(
  () => (selectedTaskId.value ? fieldApi.listPoints(selectedTaskId.value) : Promise.resolve([])),
  { interval: 5000, immediate: false, enabled: !!selectedTaskId.value },
)
const points = reactive({
  data: null as DetectionPoint[] | null,
  loading: false,
  error: null as Error | null,
  refresh: () => _points.refresh(),
})
watch(_points.data, (v) => { points.data = v }, { immediate: true })
watch(_points.loading, (v) => { points.loading = v }, { immediate: true })
watch(_points.error, (v) => { points.error = v }, { immediate: true })
// 任务变化时强制刷新一次
watch(selectedTaskId, async (id) => {
  if (id) {
    _points.pause()
    await _points.refresh()
    _points.resume()
    nextTick(() => renderMapMarkers())
  } else {
    _points.stop()
  }
})

// ============ 选中点位 → 填报 ============
const selectedPointId = ref<string | null>(null)
const selectedPoint = computed(() => (points.data || []).find((p) => p.id === selectedPointId.value) || null)

function selectPoint(id: string) {
  selectedPointId.value = id
  nextTick(() => {
    const p = selectedPoint.value
    if (p && mapInstance) {
      mapInstance.setCenter([p.lng, p.lat])
      mapInstance.setZoom(18)
    }
  })
}

const _reports = usePolling<DetectionReport[]>(
  () =>
    selectedTaskId.value && selectedPointId.value
      ? fieldApi.listReports(selectedTaskId.value, selectedPointId.value)
      : Promise.resolve([]),
  { interval: 5000, immediate: false, enabled: false },
)
const reports = reactive({
  data: null as DetectionReport[] | null,
  loading: false,
  error: null as Error | null,
  refresh: () => _reports.refresh(),
})
watch(_reports.data, (v) => { reports.data = v }, { immediate: true })
watch(_reports.loading, (v) => { reports.loading = v }, { immediate: true })
watch(_reports.error, (v) => { reports.error = v }, { immediate: true })
watch([selectedTaskId, selectedPointId], async ([tid, pid]) => {
  if (tid && pid) {
    _reports.pause()
    await _reports.refresh()
    _reports.resume()
  } else {
    _reports.stop()
  }
})

// ============ 地图 ============
const mapRef = ref<HTMLDivElement | null>(null)
const mapLoading = ref(false)
const mapError = ref('')
let mapInstance: any = null
let mapInitialized = false
const markers: any[] = []

async function initMap() {
  if (mapInitialized) return
  if (!mapRef.value) {
    // div 还没渲染好，下一帧再试
    await nextTick()
    if (!mapRef.value) return
  }
  mapLoading.value = true
  mapError.value = ''
  try {
    const AMap = await loadAMap()
    if (!mapRef.value) return  // 用户可能切走了
    mapInstance = new AMap.Map(mapRef.value, {
      zoom: 14,
      center: [116.494, 39.757],  // 兜底中心：南海家园附近
      mapStyle: 'amap://styles/normal',
    })
    mapInstance.addControl(new AMap.Scale())
    mapInstance.addControl(new AMap.ToolBar())
    mapInitialized = true
    mapLoading.value = false
    // 数据已到则立即画一次
    renderMapMarkers()
  } catch (e: any) {
    console.error('[地图] 加载失败:', e)
    mapLoading.value = false
    mapError.value = e?.message || '地图加载失败（检查 VITE_AMAP_KEY）'
  }
}

function renderMapMarkers() {
  if (!mapInstance) return
  const AMapLib = (window as any).AMap
  if (!AMapLib) return
  // 清旧
  markers.forEach((m) => mapInstance.remove(m))
  markers.length = 0
  const AMap = AMapLib
  const list = points.data || []
  if (list.length === 0) return
  list.forEach((p) => {
    const isSelected = p.id === selectedPointId.value
    const marker = new AMap.Marker({
      position: [p.lng, p.lat],
      title: `#${p.seq} ${p.location}`,
      label: {
        content: `<div style="background:${isSelected ? '#f56c6c' : '#409EFF'};color:#fff;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;">#${p.seq}</div>`,
        direction: 'top',
        offset: new AMap.Pixel(0, -8),
      },
      zIndex: isSelected ? 200 : 100,
    })
    marker.on('click', () => selectPoint(p.id))
    markers.push(marker)
  })
  mapInstance.add(markers)
  // 关键修复：只有"还没选点位"时才 setFitView
  //  - 轮询更新点位列表时不会自动缩回
  //  - 用户主动选点位后视图保持在那里
  if (!selectedPointId.value && markers.length > 0) {
    mapInstance.setFitView(markers, false, [60, 60, 60, 60])
  }
}

/**
 * 还原视图：把地图重新 fitView 到所有点位
 * - 用户主动调，不会被轮询覆盖
 * - 调用后清空 selectedPointId（让"未选点位"状态生效）
 */
function resetMapView() {
  if (!mapInstance || markers.length === 0) return
  selectedPointId.value = null
  mapInstance.setFitView(markers, false, [60, 60, 60, 60])
  ElMessage.success('已还原至全部点位')
}

// 任务点位变化 → 重画
watch(() => points.data, () => nextTick(renderMapMarkers))
watch(selectedPointId, () => nextTick(renderMapMarkers))

// 选中任务 → 初始化地图（v-if 让 div 渲染后才挂 ref）
watch(selectedTask, (t) => {
  if (t && !mapInitialized) {
    nextTick(() => initMap())
  }
})

// ============ 新建任务对话框 ============
const showCreateTask = ref(false)
const creating = ref(false)
const newTask = reactive({
  name: '',
  area: '南海家园七里',
  unit: '',
  pressureLevel: 'low' as PressureLevel,
})
const newTaskBuildingsStr = ref('')

async function onCreateTask() {
  if (!newTask.name || !newTask.area || !newTask.unit) {
    ElMessage.warning('请填写完整（任务名/区域/单元）')
    return
  }
  creating.value = true
  try {
    const created = await fieldApi.createTask({
      name: newTask.name,
      area: newTask.area,
      unit: newTask.unit,
      buildings: newTaskBuildingsStr.value
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      pressureLevel: newTask.pressureLevel,
    })
    ElMessage.success(`已创建任务：${created.name}`)
    showCreateTask.value = false
    newTask.name = ''
    newTask.unit = ''
    newTaskBuildingsStr.value = ''
    await tasks.refresh()
    selectTask(created.id)
  } catch (e: any) {
    ElMessage.error(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function onDeleteTask(t: TaskWithCount) {
  try {
    await ElMessageBox.confirm(
      `确认删除任务「${t.name}」？该任务下 ${t.pointsCount} 个点位也会一并被孤立（不会自动删点位，但 taskId 会失效）。`,
      '删除任务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await fieldApi.deleteTask(t.id)
    ElMessage.success('已删除')
    if (selectedTaskId.value === t.id) selectedTaskId.value = null
    await tasks.refresh()
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

// ============ 添加检测点 ============
const showAddPoint = ref(false)
const newPoint = reactive({
  location: '',
  lng: 116.494,
  lat: 39.757,
  dataTypes: ['位置', '土壤电阻率'] as DataType[],
})

async function onCreatePoint() {
  if (!selectedTaskId.value) return
  if (!newPoint.location) {
    ElMessage.warning('请填写位置描述')
    return
  }
  if (newPoint.dataTypes.length === 0) {
    ElMessage.warning('至少选一个检测项')
    return
  }
  creating.value = true
  try {
    const created = await fieldApi.createPoint(selectedTaskId.value, {
      location: newPoint.location,
      lng: newPoint.lng,
      lat: newPoint.lat,
      dataTypes: newPoint.dataTypes,
    })
    ElMessage.success(`已添加 #${created.seq}`)
    showAddPoint.value = false
    newPoint.location = ''
    await points.refresh()
  } catch (e: any) {
    ElMessage.error(e?.message || '添加失败')
  } finally {
    creating.value = false
  }
}

// ============ 新增填报 ============
const showAddReport = ref(false)
const newReport = reactive({
  tab: '土壤电阻率' as '土壤电阻率' | '土壤酸碱值' | '管线探测',
  地钎距离: 1.0,
  电阻值: 10.0,
  电阻率: 10.0,
  酸碱度: 7.0,
  rtkNo: '',
  埋深: 1.0,
  破损点: false,
})

async function onCreateReport() {
  if (!selectedTaskId.value || !selectedPointId.value) return
  const items: any = {}
  if (newReport.tab === '土壤电阻率') {
    items['土壤电阻率'] = {
      地钎距离: newReport.地钎距离,
      电阻值: newReport.电阻值,
      电阻率: newReport.电阻率,
      photos: [],
    }
  } else if (newReport.tab === '土壤酸碱值') {
    items['土壤酸碱值'] = { 酸碱度: newReport.酸碱度, photos: [] }
  } else {
    if (!newReport.rtkNo) {
      ElMessage.warning('请填写 RTK 编号')
      return
    }
    items['管线探测'] = {
      rtkNo: newReport.rtkNo,
      埋深: newReport.埋深,
      破损点: newReport.破损点,
      photos: [],
    }
  }
  creating.value = true
  try {
    await fieldApi.createReport(selectedTaskId.value, { pointId: selectedPointId.value, items })
    ElMessage.success('已提交')
    showAddReport.value = false
    newReport.rtkNo = ''
    await reports.refresh()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    creating.value = false
  }
}

// ============ 工具函数 ============
function pressureLabel(p: PressureLevel) {
  return p === 'low' ? '低压' : p === 'medA' ? '中压A' : '中压B'
}
function pressureType(p: PressureLevel) {
  return p === 'low' ? 'info' : p === 'medA' ? 'warning' : 'danger'
}
function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function onLogout() {
  auth.logout()
  router.push('/login')
}

// ============ 生命周期 ============
onUnmounted(() => {
  try { mapInstance?.destroy() } catch {}
  mapInitialized = false
})

// 静态资源引用（避免 webpack tree-shake 误删）
void fieldApi
</script>

<style scoped>
.ft-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow: hidden;
}

.ft-header {
  height: 52px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.ft-header-left,
.ft-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ft-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ft-user {
  font-size: 13px;
  color: #606266;
  display: flex;
  align-items: center;
  gap: 4px;
}

.ft-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 任务列表 */
.ft-tasks {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.ft-tasks-header {
  padding: 12px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ft-tasks-header > span {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.ft-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.ft-task-item {
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.15s;
}
.ft-task-item:hover { background: #f5f7fa; }
.ft-task-item.active { background: #ecf5ff; border-left: 3px solid #409eff; }
.ft-task-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 6px;
}
.ft-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  color: #909399;
  align-items: center;
}
.ft-task-points {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 主体 */
.ft-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ft-main-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ft-main-header {
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ft-main-header h3 {
  margin: 0;
  font-size: 18px;
  color: #303133;
}
.ft-main-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #606266;
}
.ft-main-meta b { color: #303133; margin-right: 4px; }
.ft-main-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.ft-main-content {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 地图 */
.ft-map-wrap {
  flex: 1;
  position: relative;
  min-width: 0;
}
.ft-map {
  width: 100%;
  height: 100%;
}
.ft-map-status {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  padding: 8px 16px;
  border-radius: 18px;
  font-size: 13px;
  color: #606266;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 100;
}
.ft-map-status--error { color: #f56c6c; }
.ft-map-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(64, 158, 255, 0.95);
  color: #fff;
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 100;
}
.ft-map-badge .dot {
  width: 6px;
  height: 6px;
  background: #fff;
  border-radius: 50%;
}

/* 还原视图按钮：浮在地图右上角（避开左边已有的 ft-map-badge） */
.ft-reset-map {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.18s;
}
.ft-reset-map:hover {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}
.ft-reset-map:active {
  transform: translateY(0);
}

/* 点位列表 */
.ft-points {
  width: 380px;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.ft-points-header {
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.ft-points-tip {
  font-size: 11px;
  color: #67c23a;
  font-weight: normal;
}
.ft-point-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 0 0 auto;
  max-height: 40%;
}
.ft-point-item {
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.ft-point-item:hover { background: #f5f7fa; }
.ft-point-item.active { background: #ecf5ff; }
.ft-point-seq {
  background: #409eff;
  color: #fff;
  width: 32px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.ft-point-info { flex: 1; min-width: 0; }
.ft-point-loc {
  font-size: 13px;
  color: #303133;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ft-point-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ft-point-coord {
  font-size: 11px;
  color: #909399;
  font-family: monospace;
  flex-shrink: 0;
}

/* 填报 */
.ft-reports {
  border-top: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.ft-reports-header {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fafafa;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}
.ft-reports-header > span { flex: 1; }
.ft-report-list {
  overflow-y: auto;
  padding: 8px 12px;
  flex: 1;
}
.ft-report-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #606266;
}
.ft-report-time {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #909399;
  font-size: 11px;
  margin-bottom: 6px;
}
.ft-report-section {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #ebeef5;
}
.ft-report-section h5 {
  margin: 0 0 4px;
  font-size: 12px;
  color: #303133;
  font-weight: 600;
}
.ft-photo-list {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.ft-photo {
  width: 60px;
  height: 60px;
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
  border: 1px solid #ebeef5;
}

.ft-empty {
  padding: 24px;
  text-align: center;
  color: #909399;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

@media (max-width: 1100px) {
  .ft-points { width: 320px; }
  .ft-tasks { width: 240px; }
}
</style>
