<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useCpStore } from '@/stores/cp'
import MapView from '@/components/MapView.vue'
import UnitCard from '@/components/UnitCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import InspectionForm from '@/components/InspectionForm.vue'
import UnitInfoCard from '@/components/UnitInfoCard.vue'
import type { CorrosionUnit } from '@/types/models'

const store = useCpStore()
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

const drawerOpen = ref(false)
const activeTab = ref('')

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

/** 右侧 UnitInfoCard 显示开关
 *  - 与 drawerOpen 互斥:单击单元 → UnitInfoCard 滑入,双击/打开抽屉 → UnitInfoCard 滑出
 *  - 默认 false,避免初始/无选中态时卡片在画面外"占位"干扰布局
 *  - 关抽屉时也置 false(关完抽屉后是空白态,用户要重新点单元才会再出卡片)
 */
const unitCardVisible = ref(false)

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

function emptyCommunity(name: string) {
  return {
    name,
    units: [] as CorrosionUnit[],
    avgProgress: 0,
    hasException: false,
  }
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

function selectUnit(u: CorrosionUnit) {
  // 重复点同一单元 → 不响应,保持当前选中状态
  //  - 之前是 toggle off(取消选中),这导致双击 B 的 click 2 触发 selectUnit(B) → store.selectUnit(null)
  //    把 dblclick 即将设的选中态打回去,抽屉闪一下就关
  //  - 改成"点已选单元不响应",click 2 走 selectUnit 也不改 store/drawerOpen 状态,不影响 dblclick 后续
  if (store.selectedUnit?.id === u.id) return
  store.selectUnit(u)
  // 单击只选中，不开抽屉 —— 关掉可能开着的抽屉，显示单元卡片
  drawerOpen.value = false
  unitCardVisible.value = true
}

/**
 * 选中单元变化时：展开对应小区 + 滚动侧栏到对应 UnitCard
 * - 触发源不区分：地图 poly 点击、UnitCard 点击、小区大圆点击最终都会改 store.selectedUnit
 * - 滚动用 block:'center',即使时机稍早,卡片也会落在可视区中心而不是顶部
 * - 400ms 是给 el-collapse accordion 展开过渡留的 buffer(默认 300ms + 100ms 余量)
 *   时机错了会滚到折叠态 offsetTop,卡片位置算错
 */
watch(() => store.selectedUnit?.id, (newId, oldId) => {
  if (newId === undefined || newId === oldId) return
  const unit = store.selectedUnit
  if (!unit) return
  // 1) 展开对应小区（accordion 单选,直接赋值切换）
  const communityName = communityOf(unit)
  if (communityName !== '未分类' && communityActive.value !== communityName) {
    communityActive.value = communityName
  }
  // 2) 等展开动画跑完再滚
  setTimeout(() => {
    const el = document.querySelector(`[data-unit-id="${unit.id}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 400)
})

function openDetail(u: CorrosionUnit) {
  store.selectUnit(u)
  // 双击 / 卡片"查看完整录入" 触发抽屉 —— 隐藏卡片,跟 drawer 互斥
  unitCardVisible.value = false
  drawerOpen.value = true
  activeTab.value = store.items[0]?.code || ''
  // 不再这里调 flyTo — MapView 里 store.selectedUnit 的 watch 会统一飞到单元,
  // 避免"openDetail 飞一次 + watch 再飞一次"的双重动画
}

function onDrawerClosed() {
  // 抽屉关闭 → 卡片也保持隐藏,选区清空,等用户再次单击/双击才重新出现
  unitCardVisible.value = false
  store.selectUnit(null)
}

/** 右侧 UnitInfoCard 底部"查看完整录入"按钮回调 → 触发抽屉 */
function openDetailFromCard() {
  if (store.selectedUnit) openDetail(store.selectedUnit)
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
      // 合上菜单 → 记住刚收起的小区,后面 watch 会把它滚到 side-panel 顶部
      lastFocusedCommunity.value = oldVal
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
    setTimeout(() => {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 350)
  })
  // 立刻 reset,保证下次再设同一个名字也能触发 watch
  lastFocusedCommunity.value = ''
})

const selectedUnit = computed(() => store.selectedUnit)

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
    <div class="side-panel">
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
                :format="(p) => `${p}%`"
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
            @detail="openDetail"
          />
          <div v-if="c.units.length === 0" class="community-empty">
            暂无数据
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="map-panel">
      <MapView ref="mapRef" :units="store.units" :points="store.points" :visibility="facilityVisibility" @select="selectUnit" @detail="openDetail" @community-focus="onCommunityFocus" @view-mode="onViewModeChange" />
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

    <UnitInfoCard
      :visible="unitCardVisible"
      @open-detail="openDetailFromCard"
    />

    <el-drawer
      v-model="drawerOpen"
      :title="selectedUnit ? `单元详情：${selectedUnit.name}` : '单元详情'"
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
          <el-descriptions-item label="中心坐标">{{ selectedUnit.lng.toFixed(6) }}, {{ selectedUnit.lat.toFixed(6) }}</el-descriptions-item>
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

        <h3 style="margin-top:24px">9 项检测数据录入</h3>
        <el-tabs v-model="activeTab">
          <el-tab-pane v-for="(it, idx) in tabItems" :key="it.code" :name="it.code">
            <template #label>
              <span>
                {{ it.name }}
                <StatusTag v-if="it.status !== 'pending'" :status="it.status" short />
              </span>
            </template>
            <InspectionForm :unit-id="selectedUnit.id" :item="store.items[idx]" @saved="store.loadAll()" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </div>
</template>