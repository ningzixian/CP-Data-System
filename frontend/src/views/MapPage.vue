<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useCpStore } from '@/stores/cp'
import MapView from '@/components/MapView.vue'
import UnitCard from '@/components/UnitCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import InspectionForm from '@/components/InspectionForm.vue'
import InsulationPerformanceForm from '@/components/InsulationPerformanceForm.vue'
import SoilResistivityForm from '@/components/SoilResistivityForm.vue'
import DcStrayCurrentForm from '@/components/DcStrayCurrentForm.vue'
import CoatingDetectForm from '@/components/CoatingDetectForm.vue'
import PipeGroundPotentialForm from '@/components/PipeGroundPotentialForm.vue'
import UnitInfoCard from '@/components/UnitInfoCard.vue'
import UnitDataModules from '@/components/UnitDataModules.vue'
import { soilResistivityPoints } from '@/utils/soilResistivity'
import { dcStrayCurrentPoints } from '@/utils/dcStrayCurrent'
import { coatingDamagePoints } from '@/utils/coatingDetect'
import { inletPotentialReadings, hasNaturalPotential } from '@/utils/pipeGroundPotential'
import type { CorrosionUnit, InspectionItemCode } from '@/types/models'

const store = useCpStore()
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

const drawerOpen = ref(false)
const activeTab = ref('')
const dataModeActive = ref(false)
const dataModulesVisible = ref(false)
const dataModulesClosing = ref(false)
const activeDataModule = ref<InspectionItemCode | null>(null)

/** 五种设施的显隐状态,左下角图例面板的 checkbox 控制
 *  - 全部默认 true,跟改之前行为一致
 *  - 通过 :visibility prop 传给 MapView,子组件 watch 同步到地图 layer group
 *  - 取消勾选 → 对应设施从地图上消失(不销毁,再次勾选回来即可)
 *  - 注意:勾选状态在小区概览模式下不影响(子组件 applyFacilityVisibility 在 isCommunityView 时 early return,
 *    缩放到细节视图时再按当前勾选状态决定显示哪些)
 */
const facilityVisibility = ref({
  unit: true,        // 控制单元范围(多边形外环 + 进度圆)
  pipe: true,        // 低压管线
  joint: true,       // 绝缘接头
  regulator: true,   // 调压箱
  inlet: true,       // 引入口
})

const unitCardVisible = computed(() =>
  !!store.selectedUnit && !drawerOpen.value && !dataModeActive.value,
)

/** 小区清单（固定顺序，与侧边栏菜单一致）
 *  - 决定 communities 计算的展示顺序与“占位”位置
 *  - 之后新增小区名：把名字按希望的位置插进这份清单即可
 */
const COMMUNITY_ORDER = [
  '南海家园七里',
  '南海家园六里', '南海家园五里', '南海家园四里', '南海家园三里', '南海家园二里', '南海家园一里',
  '亦庄金茂悦北区', '亦庄金茂悦南区',
  '金茂逸墅', '金域东郡',
  '观海苑', '棠颂璟庐',
  '鹿海园一里', '鹿海园三里', '鹿海园四里', '鹿海园五里',
  '泰河园一里', '泰河园一里二区', '泰河园三里', '泰河园四里一区', '泰河园四里二区', '泰河园七里',
  '悦廷', '亦园', '北京中芯花园', '亦城茗苑',
]

/** 从 unit.address 解析出小区名
 *  - facilities.ts 写入的格式是 "南海家园七里 · 单元 X"
 *  - 用 " · " 分隔符切第一段
 *  - 解析不出来时归到「未分类」兜底桶
 */
function communityOf(unit: CorrosionUnit): string {
  const addr = unit.address
  if (!addr) return '未分类'
  const idx = addr.indexOf(' · ')
  return idx > 0 ? addr.slice(0, idx) : '未分类'
}

/** 小区列表（按 address 前缀动态分组）
 *  - 先把 store.units 按 communityOf 分桶
 *  - 再按 COMMUNITY_ORDER 顺序拼装：有数据接 units，没数据用 emptyCommunity 占位
 *  - 出现在 store.units 但不在 COMMUNITY_ORDER 的小区自动追加到末尾（防御性）
 *  - avgProgress：该小区所有单元的平均检测进度
 *  - hasException：小区内是否任一单元异常（用于进度条 status）
 */
const communities = computed(() => {
  // 1. 按小区名分桶
  const buckets = new Map<string, CorrosionUnit[]>()
  for (const u of store.units) {
    const c = communityOf(u)
    let arr = buckets.get(c)
    if (!arr) {
      arr = []
      buckets.set(c, arr)
    }
    arr.push(u)
  }

  // 2. 按 COMMUNITY_ORDER 顺序拼装
  const known = new Set<string>()
  const result = COMMUNITY_ORDER.map((name) => {
    known.add(name)
    const units = buckets.get(name) ?? []
    return {
      name,
      units,
      avgProgress: avgProgress(units),
      hasException: units.some((u) => u.inspection_status === 'exception'),
    }
  })

  // 3. 防御性：store.units 里出现的新小区名（尚未加入 COMMUNITY_ORDER），追加到末尾
  for (const [name, units] of buckets) {
    if (known.has(name)) continue
    result.push({
      name,
      units,
      avgProgress: avgProgress(units),
      hasException: units.some((u) => u.inspection_status === 'exception'),
    })
  }

  return result
})

function avgProgress(units: CorrosionUnit[]) {
  if (units.length === 0) return 0
  return units.reduce((s, u) => s + (u.inspection_progress || 0), 0) / units.length
}

/** 小区进度条自定义颜色（按平均进度分档）
 *  - 100%  → 绿 #67c23a
 *  - 80-99% → 橙 #e6a23c
 *  - 1-79%  → 蓝 #409eff
 *  - 0%     → 浅灰 #909399
 */
function communityProgressColor(percentage: number): string {
  if (percentage >= 100) return '#67c23a'
  if (percentage > 80) return '#e6a23c'
  if (percentage > 0) return '#409eff'
  return '#909399'
}

// el-collapse accordion 模式：单值，展开一个会自动收起其他；默认全合上
const communityActive = ref<string>('')

/** 记录"刚刚聚焦的小区"——两种触发:
 *  - 合上菜单(communityActive 从有值变空):把刚收起的小区写入
 *  - 点地图大圆展开菜单(lastMapClick 命中):把刚点开的小区写入
 *  下方的 watch 会把这个小区滚到 side-panel 顶部,让用户不管怎么操作都能在可视区第一行看到
 *  - 顺序不动,只动 scrollTop
 *  - 空字符串表示"暂无聚焦动作"(初始状态)
 */
const lastFocusedCommunity = ref<string>('')
const COMMUNITY_ZOOM_DURATION_MS = 600
let selectedUnitScrollTimer: number | null = null
let communityZoomScrollTimer: number | null = null
let focusedCommunityScrollTimer: number | null = null
let dataModulesTimer: number | null = null
const DATA_MODULE_CLOSE_MS = 960

function clearDataModulesTimer() {
  if (dataModulesTimer !== null) {
    window.clearTimeout(dataModulesTimer)
    dataModulesTimer = null
  }
}

function resetDataModuleMode() {
  clearDataModulesTimer()
  dataModulesVisible.value = false
  dataModulesClosing.value = false
  dataModeActive.value = false
  activeDataModule.value = null
}

function closeDataModuleMode() {
  if (dataModulesClosing.value) return
  clearDataModulesTimer()
  if (!dataModulesVisible.value) {
    dataModeActive.value = false
    activeDataModule.value = null
    return
  }
  dataModulesClosing.value = true
  dataModulesVisible.value = false
  dataModulesTimer = window.setTimeout(() => {
    dataModulesTimer = null
    dataModulesClosing.value = false
    dataModeActive.value = false
    activeDataModule.value = null
  }, DATA_MODULE_CLOSE_MS)
}

function clearSidebarTimers() {
  if (selectedUnitScrollTimer !== null) {
    window.clearTimeout(selectedUnitScrollTimer)
    selectedUnitScrollTimer = null
  }
  if (communityZoomScrollTimer !== null) {
    window.clearTimeout(communityZoomScrollTimer)
    communityZoomScrollTimer = null
  }
  if (focusedCommunityScrollTimer !== null) {
    window.clearTimeout(focusedCommunityScrollTimer)
    focusedCommunityScrollTimer = null
  }
}

function selectUnit(u: CorrosionUnit) {
  // 重复点同一单元 → 不响应,保持当前选中状态
  //  - 避免重复点击把当前选中态取消
  //  - 打开抽屉只通过小卡片里的"查看完整录入"按钮触发
  if (store.selectedUnit?.id === u.id) return
  store.selectUnit(u)
  // 单击只选中，不开抽屉 —— 关掉可能开着的抽屉
  drawerOpen.value = false
}

/**
 * 选中单元变化时：展开对应小区 + 滚动侧栏到对应 UnitCard
 * - 触发源不区分：地图 poly 点击、UnitCard 点击、小区大圆点击最终都会改 store.selectedUnit
 * - 滚动用 block:'center',即使时机稍早,卡片也会落在可视区中心而不是顶部
 * - 400ms 是给 el-collapse accordion 展开过渡留的 buffer(默认 300ms + 100ms 余量)
 *   时机错了会滚到折叠态 offsetTop,卡片位置算错
 */
watch(() => store.selectedUnit?.id, (newId, oldId) => {
  if (newId !== oldId) {
    // 数据模块展开时允许直接点击其他控制单元切换数据：
    // 保留整组小方块，只取消当前具体模块的选中状态并刷新为新单元的数据。
    if (dataModeActive.value) {
      clearDataModulesTimer()
      dataModulesClosing.value = false
      dataModulesVisible.value = true
      activeDataModule.value = null
      drawerOpen.value = false
    }
    else resetDataModuleMode()
  }
  if (newId === undefined || newId === oldId) return
  const unit = store.selectedUnit
  if (!unit) return
  // 1) 展开对应小区（accordion 单选,直接赋值切换）
  const communityName = communityOf(unit)
  if (communityName !== '未分类' && communityActive.value !== communityName) {
    communityActive.value = communityName
  }
  // 2) 等展开动画跑完再滚
  if (selectedUnitScrollTimer !== null) window.clearTimeout(selectedUnitScrollTimer)
  selectedUnitScrollTimer = window.setTimeout(() => {
    selectedUnitScrollTimer = null
    if (store.selectedUnit?.id !== newId) return
    const el = document.querySelector(`[data-unit-id="${unit.id}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 400)
})

function openDetail(u: CorrosionUnit) {
  store.selectUnit(u)
  resetDataModuleMode()
  // 卡片"查看完整录入"触发抽屉,小卡片由 unitCardVisible 自动隐藏
  drawerOpen.value = true
  activeTab.value = store.items[0]?.code || ''
  // 不再这里调 flyTo — MapView 里 store.selectedUnit 的 watch 会统一飞到单元,
  // 避免"openDetail 飞一次 + watch 再飞一次"的双重动画
}

function onDrawerClosed() {
  // 抽屉关闭后保留选中单元,小卡片会由 unitCardVisible 自动恢复
}

/** 右侧 UnitInfoCard 底部"查看完整录入"按钮回调 → 触发抽屉 */
function openDetailFromCard() {
  if (store.selectedUnit) openDetail(store.selectedUnit)
}

function openDataModules() {
  if (!store.selectedUnit || dataModeActive.value) return
  clearDataModulesTimer()
  dataModulesClosing.value = false
  dataModeActive.value = true
  // 先等待右侧信息卡片完成 150ms 离场，再从地图右上方展开牌组。
  dataModulesTimer = window.setTimeout(() => {
    dataModulesTimer = null
    if (store.selectedUnit && dataModeActive.value) dataModulesVisible.value = true
  }, 180)
}

function returnToUnitCard() {
  if (!dataModeActive.value) return
  closeDataModuleMode()
}

/** 数据模块点击预留接口：后续可按检测项目编码打开对应的数据视图。 */
function onDataModuleSelect(code: InspectionItemCode) {
  activeDataModule.value = code === 'JOINT_VERIFY' || code === 'SOIL_RESISTIVITY' || code === 'DC_STRAY_CURRENT' || code === 'COATING_DETECT' || code === 'PIPE_GROUND_POTENTIAL' ? code : null
}

function clearActiveDataModule() {
  activeDataModule.value = null
}

function openInsulationEditor() {
  if (!store.selectedUnit) return
  activeTab.value = 'JOINT_VERIFY'
  drawerOpen.value = true
}

function openSoilEditor() {
  if (!store.selectedUnit) return
  activeTab.value = 'SOIL_RESISTIVITY'
  drawerOpen.value = true
}

function openDcStrayEditor() {
  if (!store.selectedUnit) return
  activeTab.value = 'DC_STRAY_CURRENT'
  drawerOpen.value = true
}

function openCoatingEditor() {
  if (!store.selectedUnit) return
  activeTab.value = 'COATING_DETECT'
  drawerOpen.value = true
}

function openPipePotentialEditor() {
  if (!store.selectedUnit) return
  activeTab.value = 'PIPE_GROUND_POTENTIAL'
  drawerOpen.value = true
}

/** 标记"上次点的大圆名字",watch 里如果新值跟它匹配就跳过
 *  - 用名字而不是 boolean:避免"重复点同一大圆 → 标志卡在 true → 后续菜单切换不飞"的 bug
 *  - 每次 onCommunityFocus 都覆盖(重复点同小区时),保证下一次 watch 触发时能正确消费
 */
let lastMapClick: string | null = null

/** 点击地图上的小区大圆 → 展开对应小区（accordion 模式直接覆盖） */
function onCommunityFocus(name: string) {
  lastMapClick = name
  communityActive.value = name
}

/** 地图缩放跨过小区/细节阈值时,合上小区菜单
 *  - 进入小区概览:菜单内容跟地图不匹配(地图是合并大圆,菜单是单个小区的单元),合上避免误导
 *  - 进入细节视图:不动菜单(用户可能在社区大圆点击时手动展开过某个小区)
 *  - 只在菜单非空时清空,避免无意义的 ref 变化触发 watch
 */
function onViewModeChange(mode: 'community' | 'detail') {
  if (mode === 'community' && communityActive.value !== '') {
    communityActive.value = ''
  }
}

/** 菜单变化时联动地图 + 滚动列表:
 *  - lastMapClick 匹配:菜单变化是点大圆触发的,地图已飞过,这里跳过 flyTo
 *    只清标志 + 滚侧栏
 *  - 从有到空(合上):zoomToCommunityView() 缩到小区概览级,保持当前中心(不重定位)
 *    + 记住刚收起的小区 → lastFocusedCommunity,下方 watch 会把它滚到侧栏顶部
 *  - 从空/旧值到新值(打开/切换):**不再 flyTo** 地图——保持当前视野,只让侧栏滚到对应小区
 *    想聚焦到某个小区请直接点地图上的大圆(onCommunityFocus 走 lastMapClick 路径)
 */
watch(communityActive, (newVal, oldVal) => {
  if (lastMapClick !== null && newVal === lastMapClick) {
    // 匹配上"上次点的大圆":地图已飞过,跳过;但要让侧栏也滚到对应小区
    lastMapClick = null
    lastFocusedCommunity.value = newVal
    return
  }
  if (!newVal) {
    if (oldVal) {
      // 合上菜单时先让地图缩放,再滚动侧栏,避免两个动画抢主线程
      if (communityZoomScrollTimer !== null) window.clearTimeout(communityZoomScrollTimer)
      communityZoomScrollTimer = window.setTimeout(() => {
        communityZoomScrollTimer = null
        if (communityActive.value === '') lastFocusedCommunity.value = oldVal
      }, COMMUNITY_ZOOM_DURATION_MS)
    }
    mapRef.value?.zoomToCommunityView()
    return
  }
  if (oldVal !== newVal) {
    // 菜单展开/切换 → 不再 flyTo 地图,只滚侧栏
    lastFocusedCommunity.value = newVal
  }
})

/** 刚聚焦的小区变化时,把它滚到 side-panel 可视区顶部
 *  - 触发源两个:合上菜单 / 点地图大圆展开 / 菜单里手动切换小区
 *  - 用 scrollIntoView(block: 'start'):让元素顶部对齐到滚动容器顶部
 *  - 不改 COMMUNITY_ORDER,顺序保持原样,只动 scrollTop
 *  - 必须等 el-collapse accordion 展开 transition 跑完再滚!
 *    原因:nextTick 时 B 还在折叠态,B 标题 div 的位置 = 折叠态 offsetTop
 *    transition 跑 ~300ms 期间,A 收起 + B 内容展开,整体列表重排,B 标题 div 位置会变
 *    此时 scrollIntoView 拿到的位置是错的,展开完后标题就跑到可视区外了
 *  - scroll 完立刻清回 '':不然后续"同一个小区再次聚焦"会因为值没变,watch 不触发(典型场景:点大圆打开 A → 滚动 → 缩放地图合上 A,A 已经聚焦过,值没变就不滚了)
 */
watch(lastFocusedCommunity, (name) => {
  if (!name) return
  nextTick(() => {
    const el = document.querySelector(`[data-community-name="${name}"]`)
    if (!el) {
      lastFocusedCommunity.value = ''
      return
    }
    // el-collapse 默认 transition 300ms,350ms 留 buffer
    if (focusedCommunityScrollTimer !== null) window.clearTimeout(focusedCommunityScrollTimer)
    focusedCommunityScrollTimer = window.setTimeout(() => {
      focusedCommunityScrollTimer = null
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 350)
  })
  // 立刻 reset,保证下次再设同一个名字也能触发 watch
  lastFocusedCommunity.value = ''
})

onBeforeUnmount(() => {
  clearSidebarTimers()
  resetDataModuleMode()
  drawerOpen.value = false
  if (store.hoveredUnit) store.hoverUnit(null)
  if (store.selectedUnit) store.selectUnit(null)
})

const selectedUnit = computed(() => store.selectedUnit)

const selectedUnitInlets = computed(() => {
  const unitId = selectedUnit.value?.id
  if (!unitId) return []
  return (store.facilities?.inlets ?? []).filter((inlet) => inlet.unit_id === unitId)
})

const selectedUnitSoilPoints = computed(() => {
  const unitId = selectedUnit.value?.id
  if (!unitId) return []
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'SOIL_RESISTIVITY')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  return soilResistivityPoints(record)
})

const selectedUnitDcStrayPoints = computed(() => {
  const unitId = selectedUnit.value?.id
  if (!unitId) return []
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'DC_STRAY_CURRENT')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  return dcStrayCurrentPoints(record)
})

const selectedUnitCoatingPoints = computed(() => {
  const unitId = selectedUnit.value?.id
  if (!unitId) return []
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'COATING_DETECT')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  return coatingDamagePoints(record)
})

const selectedUnitPotentialCompleted = computed(() => {
  const unitId = selectedUnit.value?.id
  if (!unitId) return 0
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'PIPE_GROUND_POTENTIAL')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  return [...inletPotentialReadings(record).values()].filter(hasNaturalPotential).length
})

function unitCenterText(unit: CorrosionUnit): string {
  return unit.lng !== undefined && unit.lat !== undefined
    ? `${unit.lng.toFixed(6)}, ${unit.lat.toFixed(6)}`
    : '—'
}

const tabItems = computed(() =>
  store.items.map((it) => ({
    code: it.code,
    name: it.name,
    status: selectedUnit.value ? store.getItemStatus(selectedUnit.value.id, it.code) : 'pending',
  })),
)
</script>

<template>
  <div class="main-content">
    <div class="side-panel map-side-panel">
      <div class="stats-bar">
        <div class="stat-item">
          <div class="num" style="color:#67c23a">{{ store.stats.completed }}</div>
          <div class="label">已完成</div>
        </div>
        <div class="stat-item">
          <div class="num" style="color:#e6a23c">{{ store.stats.in_progress }}</div>
          <div class="label">进行中</div>
        </div>
        <div class="stat-item">
          <div class="num" style="color:#909399">{{ store.stats.pending }}</div>
          <div class="label">待开始</div>
        </div>
        <div class="stat-item">
          <div class="num" style="color:#f56c6c">{{ store.stats.exception }}</div>
          <div class="label">异常</div>
        </div>
      </div>

      <div v-if="store.units.length === 0" class="empty-tip">
        <div v-if="store.loading">
          <el-icon class="is-loading" size="32"><svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="10" fill="none" stroke="#409eff" stroke-width="3" stroke-dasharray="30 70"/></svg></el-icon>
          <div style="margin-top:8px">正在加载数据...</div>
        </div>
        <div v-else>
          <div>暂无数据</div>
          <div style="font-size:12px;margin-top:4px">请先在「数据管理」中新增腐控单元</div>
        </div>
      </div>

      <!-- 小区分组（el-collapse accordion 手风琴模式 + 卡片 staggered 展开动效） -->
      <el-collapse v-model="communityActive" accordion class="community-collapse">
        <el-collapse-item v-for="c in communities" :key="c.name" :name="c.name">
          <template #title>
            <div class="community-header" :data-community-name="c.name">
              <span class="name">{{ c.name }}</span>
              <el-progress
                v-if="c.units.length > 0"
                :percentage="Math.round(c.avgProgress * 100)"
                :stroke-width="5"
                :show-text="true"
                :status="c.hasException ? 'exception' : ''"
                :color="communityProgressColor"
                :format="(p: number) => `${p}%`"
                class="community-progress"
              />
              <span class="meta">{{ c.units.length }} 个单元</span>
            </div>
          </template>
          <UnitCard
            v-for="u in c.units"
            :key="u.id"
            :unit="u"
            @select="selectUnit"
          />
          <div v-if="c.units.length === 0" class="community-empty">
            暂无数据
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="map-panel">
      <MapView ref="mapRef" :units="store.units" :points="store.points" :visibility="facilityVisibility" :active-data-module="activeDataModule" :data-module-mode="dataModeActive" @select="selectUnit" @community-focus="onCommunityFocus" @view-mode="onViewModeChange" @clear-data-module="clearActiveDataModule" />
      <Transition name="insulation-toolbar">
        <div v-if="activeDataModule === 'JOINT_VERIFY' && selectedUnit" class="insulation-map-toolbar">
          <div class="insulation-map-toolbar-icon">Ω</div>
          <div><strong>绝缘性能展示</strong><span>{{ selectedUnit.name }} · {{ selectedUnitInlets.length }} 个引入口</span></div>
          <button type="button" @click="openInsulationEditor">编辑绝缘数据</button>
        </div>
      </Transition>
      <Transition name="insulation-toolbar">
        <div v-if="activeDataModule === 'SOIL_RESISTIVITY' && selectedUnit" class="insulation-map-toolbar soil-map-toolbar">
          <div class="insulation-map-toolbar-icon">ρ</div>
          <div><strong>土壤电阻率展示</strong><span>{{ selectedUnit.name }} · {{ selectedUnitSoilPoints.length }} 个测试位置</span></div>
          <button type="button" @click="openSoilEditor">编辑检测数据</button>
        </div>
      </Transition>
      <Transition name="insulation-toolbar">
        <div v-if="activeDataModule === 'DC_STRAY_CURRENT' && selectedUnit" class="insulation-map-toolbar dc-map-toolbar">
          <div class="insulation-map-toolbar-icon">V</div>
          <div><strong>直流杂散电流展示</strong><span>{{ selectedUnit.name }} · {{ selectedUnitDcStrayPoints.length }} 个监测点</span></div>
          <button type="button" @click="openDcStrayEditor">编辑直流数据</button>
        </div>
      </Transition>
      <Transition name="insulation-toolbar">
        <div v-if="activeDataModule === 'COATING_DETECT' && selectedUnit" class="insulation-map-toolbar coating-map-toolbar">
          <div class="insulation-map-toolbar-icon">×</div>
          <div><strong>防腐层破损点展示</strong><span>{{ selectedUnit.name }} · {{ selectedUnitCoatingPoints.length }} 处破损点</span></div>
          <button type="button" @click="openCoatingEditor">编辑破损点数据</button>
        </div>
      </Transition>
      <Transition name="insulation-toolbar">
        <div v-if="activeDataModule === 'PIPE_GROUND_POTENTIAL' && selectedUnit" class="insulation-map-toolbar potential-map-toolbar">
          <div class="insulation-map-toolbar-icon">V</div>
          <div><strong>自然电位展示</strong><span>{{ selectedUnit.name }} · {{ selectedUnitPotentialCompleted }}/{{ selectedUnitInlets.length }} 个引入口已检测</span></div>
          <button type="button" @click="openPipePotentialEditor">编辑自然电位</button>
        </div>
      </Transition>
      <div class="map-legend">
        <!-- 进度状态图例(只读,纯说明) -->
        <div class="legend-section legend-section--readonly">
          <div><span class="dot" style="background:#67c23a"></span>已完成</div>
          <div><span class="dot" style="background:#e6a23c"></span>进行中</div>
          <div><span class="dot" style="background:#909399"></span>待开始</div>
          <div><span class="dot" style="background:#f56c6c"></span>异常</div>
        </div>

        <!-- 设施显隐面板(可勾选,checkbox 控制地图 layer) -->
        <div class="legend-section legend-section--toggle">
          <label class="legend-row" :class="{ 'is-off': !facilityVisibility.unit }">
            <input type="checkbox" v-model="facilityVisibility.unit" />
            <span style="display:inline-block;width:14px;height:10px;background:rgba(103,194,58,0.18);border:1.5px dashed #67c23a;vertical-align:middle;margin-right:6px"></span>
            <span class="legend-label">低压制控制单元</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !facilityVisibility.pipe }">
            <input type="checkbox" v-model="facilityVisibility.pipe" />
            <span style="display:inline-block;width:18px;height:0;border-top:3px solid #67c23a;vertical-align:middle;margin-right:6px"></span>
            <span class="legend-label">低压燃气管道</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !facilityVisibility.joint }">
            <input type="checkbox" v-model="facilityVisibility.joint" />
            <span style="color:#f56c6c;font-weight:900;font-size:14px;margin-right:4px">✕</span>
            <span class="legend-label">绝缘接头</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !facilityVisibility.regulator }">
            <input type="checkbox" v-model="facilityVisibility.regulator" />
            <span style="display:inline-block;width:14px;height:14px;background:#1890ff;border-radius:3px;vertical-align:middle;margin-right:6px;color:#fff;font-size:10px;text-align:center;line-height:14px">调</span>
            <span class="legend-label">调压箱</span>
          </label>
          <label class="legend-row" :class="{ 'is-off': !facilityVisibility.inlet }">
            <input type="checkbox" v-model="facilityVisibility.inlet" />
            <span style="display:inline-block;width:8px;height:8px;background:#909399;border-radius:50%;vertical-align:middle;margin-right:8px"></span>
            <span class="legend-label">引入口</span>
          </label>
        </div>
      </div>
    </div>

    <UnitDataModules
      :visible="dataModulesVisible && !!selectedUnit"
      :active-code="activeDataModule"
      @return="returnToUnitCard"
      @select="onDataModuleSelect"
    />

    <UnitInfoCard
      :visible="unitCardVisible"
      @open-detail="openDetailFromCard"
      @open-data-modules="openDataModules"
    />

    <el-drawer
      v-model="drawerOpen"
      :title="selectedUnit ? (activeDataModule === 'JOINT_VERIFY' ? `绝缘性能：${selectedUnit.name}` : activeDataModule === 'SOIL_RESISTIVITY' ? `土壤电阻率：${selectedUnit.name}` : activeDataModule === 'DC_STRAY_CURRENT' ? `直流杂散电流：${selectedUnit.name}` : activeDataModule === 'COATING_DETECT' ? `防腐层检测：${selectedUnit.name}` : activeDataModule === 'PIPE_GROUND_POTENTIAL' ? `管地腐蚀电位：${selectedUnit.name}` : `单元详情：${selectedUnit.name}`) : '单元详情'"
      size="80%"
      direction="rtl"
      @closed="onDrawerClosed"
    >
      <div v-if="selectedUnit" style="padding:0 20px 20px">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="单元名称">{{ selectedUnit.name }}</el-descriptions-item>
          <el-descriptions-item label="整体进度">
            <el-progress :percentage="Math.round(selectedUnit.inspection_progress * 100)" />
          </el-descriptions-item>
          <el-descriptions-item label="地址">{{ selectedUnit.address || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <StatusTag :status="selectedUnit.inspection_status" />
          </el-descriptions-item>
          <el-descriptions-item label="中心坐标">{{ unitCenterText(selectedUnit) }}</el-descriptions-item>
          <el-descriptions-item label="最近检测">{{ selectedUnit.last_inspection_at || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-row :gutter="12" style="margin-top:16px">
          <el-col :span="12">
            <el-card shadow="never" style="background:#f0f9eb">
              <div style="text-align:center">
                <div style="font-size:24px;color:#67c23a;font-weight:600">{{ store.unitJointCount(selectedUnit.id) }}</div>
                <div style="font-size:12px;color:#909399">绝缘接头（边界）</div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never" style="background:#ecf5ff">
              <div style="text-align:center">
                <div style="font-size:24px;color:#1890ff;font-weight:600">{{ store.unitInletCount(selectedUnit.id) }}</div>
                <div style="font-size:12px;color:#909399">引入口</div>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <h3 style="margin-top:24px">7 项检测数据录入</h3>
        <el-tabs v-model="activeTab">
          <el-tab-pane v-for="(it, idx) in tabItems" :key="it.code" :name="it.code">
            <template #label>
              <span>
                {{ it.name }}
                <StatusTag v-if="it.status !== 'pending'" :status="it.status" short />
              </span>
            </template>
            <InsulationPerformanceForm
              v-if="it.code === 'JOINT_VERIFY'"
              :unit-id="selectedUnit.id"
              :inlets="selectedUnitInlets"
            />
            <SoilResistivityForm
              v-else-if="it.code === 'SOIL_RESISTIVITY'"
              :unit-id="selectedUnit.id"
              :unit-lng="selectedUnit.lng"
              :unit-lat="selectedUnit.lat"
            />
            <DcStrayCurrentForm
              v-else-if="it.code === 'DC_STRAY_CURRENT'"
              :unit-id="selectedUnit.id"
              :unit-lng="selectedUnit.lng"
              :unit-lat="selectedUnit.lat"
            />
            <CoatingDetectForm
              v-else-if="it.code === 'COATING_DETECT'"
              :unit-id="selectedUnit.id"
              :unit-lng="selectedUnit.lng"
              :unit-lat="selectedUnit.lat"
            />
            <PipeGroundPotentialForm
              v-else-if="it.code === 'PIPE_GROUND_POTENTIAL'"
              :unit-id="selectedUnit.id"
              :inlets="selectedUnitInlets"
            />
            <InspectionForm v-else :unit-id="selectedUnit.id" :item="store.items[idx]" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </div>
</template>
