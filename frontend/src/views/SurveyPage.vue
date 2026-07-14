<script setup lang="ts">
/**
 * 管线勘测页 — 独立板块
 *
 * Step 2:加点位(add-point 模式)+ 点位编辑
 *  - 切到「+ 点位」模式,鼠标变 crosshair,点击地图弹三选菜单
 *  - view 模式,点击点位 marker 打开编辑浮层(类型/角度/埋深/电流/备注/删除)
 *  - 撤销/重做已就绪
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useCpStore } from '@/stores/cp'
import { useSurveyStore } from '@/stores/survey'
import SurveyMapView from '@/components/SurveyMapView.vue'
import type { SurveyPoint, SurveyPointType, SurveyEndpointId, SurveyBox } from '@/types/survey'

const store = useCpStore()
const survey = useSurveyStore()
const mapRef = ref<InstanceType<typeof SurveyMapView> | null>(null)

// ========== 当前激活的小区 ==========
const SURVEY_COMMUNITY = '南海家园三里'
/** 现场打点 CSV 路径 */
const SURVEY_CSV_URL = `${import.meta.env.BASE_URL}data/Pipe detection data/南海家园三里_2026-7-14-13-51-13（增加经纬度）.csv`

// ========== 数据筛选:只取南海家园三里 ==========
const surveyPipes = computed(() => {
  const allPipes = store.facilities?.pipes ?? []
  return allPipes.filter((p) => p.community === SURVEY_COMMUNITY)
})
const surveyInlets = computed(() => {
  const allInlets = store.facilities?.inlets ?? []
  return allInlets.filter((inlet) => inlet.community === SURVEY_COMMUNITY)
})
const surveyUnits = computed(() =>
  store.units.filter((u) => (u.address ?? '').startsWith(SURVEY_COMMUNITY)),
)
const surveyJoints = computed(() =>
  (store.facilities?.joints ?? []).filter((joint) => joint.community === SURVEY_COMMUNITY),
)
const surveyRegulators = computed(() =>
  (store.facilities?.regulators ?? []).filter((regulator) => regulator.community === SURVEY_COMMUNITY),
)
const surveyStats = computed(() => ({
  unitCount: surveyUnits.value.length,
  pipeCount: surveyPipes.value.length,
  inletCount: surveyInlets.value.length,
  jointCount: surveyJoints.value.length,
  regulatorCount: surveyRegulators.value.length,
  pointCount: survey.points.length,
  lineCount: survey.lines.length,
}))

/** 左侧点位列表按编号末尾数字升序展示。 */
const sortedSurveyPoints = computed(() => [...survey.points].sort((a, b) => {
  const aNumber = Number(a.id.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER)
  const bNumber = Number(b.id.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER)
  return aNumber - bNumber || a.id.localeCompare(b.id)
}))

// ========== 模式 / 编辑状态 ==========
const mode = ref<'view' | 'add-point' | 'connect' | 'edit' | 'box'>('view')
/** 当前正在编辑的点位 id(传给 SurveyMapView 让它显示编辑浮层) */
const editingPointId = ref<string | null>(null)
/** 列表里选中的点位(高亮,不一定要编辑) */
const selectedPointId = ref<string | null>(null)
const communityExpanded = ref(true)

// ========== 工具栏回调 ==========
function onUndo() { survey.undo() }
function onRedo() { survey.redo() }

function switchMode(next: typeof mode.value) {
  // 切换模式时,关闭可能开着的编辑面板
  if (editingPointId.value) editingPointId.value = null
  mapRef.value?.clearPointInfo()
  mode.value = next
}

// ========== SurveyMapView 事件回调 ==========
function onCreatePoint(payload: { lat: number; lng: number; type: SurveyPointType }) {
  survey.addPoint({
    lng: payload.lng,
    lat: payload.lat,
    type: payload.type,
    rotation: 0,  // straight 强制 0,tee/elbow 用户编辑时再设
  })
  // 创建后保持在 add-point 模式,方便连续加点
}

function onPointClick(id: string) {
  selectedPointId.value = id
  if (mode.value === 'view') {
    editingPointId.value = null
    mapRef.value?.showPointInfo(id)
    return
  }
  mapRef.value?.clearPointInfo()
  mapRef.value?.focusPoint(id)
  editingPointId.value = mode.value === 'edit' ? id : null
}

function onListPointClick(id: string) {
  onPointClick(id)
}

function pointTypeLabel(type: SurveyPointType) {
  if (type === 'tee') return '三通'
  if (type === 'elbow') return '弯头'
  if (type === 'joint') return '绝缘接头'
  if (type === 'inlet') return '引入口'
  return '普通'
}

function onUpdatePoint(payload: { id: string; patch: Partial<SurveyPoint> }) {
  survey.updatePoint(payload.id, payload.patch)
}
function onDeletePoint(id: string) {
  survey.removePoint(id)
  if (selectedPointId.value === id) selectedPointId.value = null
}
function onCloseEditor() {
  editingPointId.value = null
}

/** connect 模式拖拽完成 → 落地一条管线
 *  - fromId/toId 是端点 ID,可能是 'point:xx' 或 'inlet:xx'
 *  - store.addLine 内部会 push history + 防重复
 */
function onCreateLine(payload: { fromId: SurveyEndpointId; toId: SurveyEndpointId }) {
  const created = survey.addLine(payload)
  if (!created) ElMessage.warning('这两个点之间已经存在管线，不能重复连线')
}

/** 点击管线 → 弹菜单 → 用户点删除按钮才触发 */
function onRemoveLine(id: string) {
  survey.removeLine(id)
}

function onCreateBox(bounds: Omit<SurveyBox, 'id' | 'createdAt'>) {
  survey.addBox(bounds)
}

function onRemoveBox(id: string) {
  survey.removeBox(id)
}

function onUpdateBox(payload: { id: string; bounds: Omit<SurveyBox, 'id' | 'createdAt'> }) {
  survey.updateBox(payload.id, payload.bounds)
}

// ========== 图例显隐 ==========
const pipeVisible = ref(true)
const inletVisible = ref(true)
const unitVisible = ref(true)
const jointVisible = ref(true)
const regulatorVisible = ref(true)
const surveyPointVisible = ref(true)
const surveyLineVisible = ref(true)

// ========== 生命周期 ==========
onMounted(async () => {
  if (store.units.length === 0) {
    await store.loadAll()
  }
  await survey.loadPointsFromCsv(SURVEY_CSV_URL)
})
</script>

<template>
  <div class="main-content">
    <!-- 左侧菜单栏:工具栏 + 可折叠小区点位列表 -->
    <div class="side-panel survey-side-panel">
      <!-- 工具栏:模式 + 编辑工具 + 撤销/重做 -->
      <div class="survey-toolbar">
        <div class="survey-toolbar-row">
          <button
            class="survey-tool-btn"
            :class="{ active: mode === 'view' }"
            @click="switchMode('view')"
            title="查看模式"
          >👁 查看</button>
          <button
            class="survey-tool-btn"
            :class="{ active: mode === 'add-point' }"
            @click="switchMode('add-point')"
            title="点击地图添加点位"
          >+ 点位</button>
          <button
            class="survey-tool-btn"
            :class="{ active: mode === 'connect' }"
            @click="switchMode('connect')"
            title="点一个点位拖到另一个点位,松手生成管线"
          >🔗 连线</button>
        </div>
        <div class="survey-toolbar-row">
          <button
            class="survey-tool-btn"
            :class="{ active: mode === 'edit' }"
            @click="switchMode('edit')"
            title="拖动勘测点位调整位置"
          >✥ 编辑</button>
          <button
            class="survey-tool-btn"
            :class="{ active: mode === 'box' }"
            @click="switchMode('box')"
            title="在地图上拖动绘制红色虚线标识框"
          >▧ 框选</button>
        </div>
        <div class="survey-toolbar-row">
          <button
            class="survey-tool-btn"
            :class="{ disabled: !survey.canUndo }"
            :disabled="!survey.canUndo"
            @click="onUndo"
            title="撤销"
          >↶ 撤销</button>
          <button
            class="survey-tool-btn"
            :class="{ disabled: !survey.canRedo }"
            :disabled="!survey.canRedo"
            @click="onRedo"
            title="重做"
          >↷ 重做</button>
        </div>
      </div>

      <!-- 小区折叠菜单：当前所有点位归入南海家园三里 -->
      <button
        type="button"
        class="survey-community-toggle"
        :class="{ expanded: communityExpanded }"
        :aria-expanded="communityExpanded"
        @click="communityExpanded = !communityExpanded"
      >
        <span class="survey-community-arrow">▶</span>
        <span class="survey-community-title">{{ SURVEY_COMMUNITY }}</span>
        <span class="survey-community-meta">
          {{ surveyStats.unitCount }} 单元 ｜ {{ surveyStats.pipeCount }} 管线 ｜ {{ surveyStats.inletCount }} 引入
        </span>
      </button>
      <div v-show="communityExpanded" class="survey-community-content">
        <div class="survey-list">
        <div class="survey-list-header">
          勘测点位（{{ survey.points.length }}）
        </div>
        <div v-if="survey.points.length === 0" class="empty-tip">
          <div v-if="store.loading || !survey.points.length">正在加载 CSV...</div>
          <div v-else>暂无点位</div>
        </div>
        <div
          v-for="p in sortedSurveyPoints"
          :key="p.id"
          class="survey-point-row"
          :class="{ active: selectedPointId === p.id }"
          :data-point-id="p.id"
          @click="onListPointClick(p.id)"
        >
          <span
            class="survey-point-type-dot"
            :class="[`type-${p.type}`, `source-${p.source || 'csv'}`]"
          ></span>
          <span class="survey-point-id">{{ p.id }}</span>
          <span class="survey-point-type">
            {{ pointTypeLabel(p.type) }}
          </span>
        </div>
        </div>
      </div>
    </div>

    <!-- 右侧:地图 + 左下角图例 -->
    <div class="map-panel">
      <SurveyMapView
        ref="mapRef"
        :pipes="surveyPipes"
        :inlets="surveyInlets"
        :units="surveyUnits"
        :joints="surveyJoints"
        :regulators="surveyRegulators"
        :survey-points="survey.points"
        :survey-lines="survey.lines"
        :survey-boxes="survey.boxes"
        :visible="pipeVisible"
        :inlets-visible="inletVisible"
        :units-visible="unitVisible"
        :joints-visible="jointVisible"
        :regulators-visible="regulatorVisible"
        :survey-points-visible="surveyPointVisible"
        :survey-lines-visible="surveyLineVisible"
        :mode="mode"
        :editing-point-id="editingPointId"
        @create-point="onCreatePoint"
        @point-click="onPointClick"
        @update-point="onUpdatePoint"
        @delete-point="onDeletePoint"
        @close-editor="onCloseEditor"
        @create-line="onCreateLine"
        @remove-line="onRemoveLine"
        @create-box="onCreateBox"
        @update-box="onUpdateBox"
        @remove-box="onRemoveBox"
      />

      <div class="map-legend">
        <div class="legend-section legend-section--readonly">
          <div><span class="dot" style="background:#67c23a"></span>燃气管线</div>
          <div><span class="dot" style="background:#909399"></span>引入口</div>
          <div><span class="dot" style="background:#7a3e2e"></span>勘测管线</div>
          <div><span class="dot" style="background:#e6a23c"></span>勘测点位</div>
        </div>
        <div class="legend-section legend-section--toggle">
          <label class="legend-row" :class="{ 'is-off': !unitVisible }">
            <input type="checkbox" v-model="unitVisible" />
            <span class="legend-label">控制单元（{{ surveyStats.unitCount }}）</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !pipeVisible }">
            <input type="checkbox" v-model="pipeVisible" />
            <span class="legend-label">燃气管线（{{ surveyStats.pipeCount }}）</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !inletVisible }">
            <input type="checkbox" v-model="inletVisible" />
            <span class="legend-label">引入口（{{ surveyStats.inletCount }}）</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !jointVisible }">
            <input type="checkbox" v-model="jointVisible" />
            <span class="legend-label">绝缘接头（{{ surveyStats.jointCount }}）</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !regulatorVisible }">
            <input type="checkbox" v-model="regulatorVisible" />
            <span class="legend-label">调压箱（{{ surveyStats.regulatorCount }}）</span>
          </label>
          <div class="legend-divider" aria-hidden="true"></div>
          <label class="legend-row" :class="{ 'is-off': !surveyPointVisible }">
            <input type="checkbox" v-model="surveyPointVisible" />
            <span class="legend-label">勘测点位（{{ surveyStats.pointCount }}）</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !surveyLineVisible }">
            <input type="checkbox" v-model="surveyLineVisible" />
            <span class="legend-label">勘测管线（{{ surveyStats.lineCount }}）</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
