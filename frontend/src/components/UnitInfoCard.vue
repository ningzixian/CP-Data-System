<script setup lang="ts">
/**
 * 右侧单元信息卡片 —— 给领导汇报用
 *
 * 触发:单击控制单元(poly 或 UnitCard),不与双击抽屉冲突
 * 位置:右侧悬浮卡片,上/下/右各留 20px 空隙,宽 280px,竖向填满 70vh+
 * 风格:大字号进度环 + 状态色块 + 9 项检测矩阵,一眼能看清进度
 *
 * 显示逻辑:
 *  - store.selectedUnit 有值 → 滑入
 *  - store.selectedUnit 为 null → 滑出
 *  - 切换单元(selectedUnit.id 变)→ 内容刷新,不重开动画
 *
 * 与双击抽屉的关系:
 *  - 单击 → 本卡片(快速浏览)
 *  - 双击 → 抽屉(完整 9 项录入表单)
 *  - 卡片底部"查看完整录入 →" 按钮 → 触发抽屉
 */
import { computed } from 'vue'
import { useCpStore } from '@/stores/cp'
import { STATUS_LABELS, STATUS_COLORS } from '@/types/items'
import { polygonAreaM2 } from '@/utils/geo'

const props = defineProps<{
  /** 是否显示卡片 —— 由父组件(MapPage)控制,跟 el-drawer 互斥
   *  - false → 内部 <aside> v-if 为 false,Transition 跑 leave 动画
   *  - true + 有选中单元 → 显示
   *  - 组件本身常驻,不做外层 v-if,避免组件销毁导致 leave 动画来不及跑
   */
  visible?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-detail'): void
}>()

const store = useCpStore()

const unit = computed(() => store.selectedUnit)
/** 内部 aside 的 v-if 条件:visible prop + 有选中单元
 *  - 用 computed 包一下,让模板里 v-if 读起来更清晰
 *  - 组件本身常驻,只在两个条件同时成立时才显示
 */
const isOpen = computed(() => !!props.visible && !!unit.value)

const progressPct = computed(() =>
  unit.value ? Math.round(unit.value.inspection_progress * 100) : 0,
)
const completedCount = computed(() =>
  unit.value ? Math.round(unit.value.inspection_progress * 9) : 0,
)

const statusText = computed(() =>
  unit.value ? STATUS_LABELS[unit.value.inspection_status] || '—' : '—',
)
const statusColor = computed(() =>
  unit.value ? STATUS_COLORS[unit.value.inspection_status] || '#909399' : '#909399',
)

const jointCount = computed(() =>
  unit.value ? store.unitJointCount(unit.value.id) : 0,
)
const inletCount = computed(() =>
  unit.value ? store.unitInletCount(unit.value.id) : 0,
)

/**
 * 单元面积(m²) —— 从 polyline 计算多边形面积
 * - polyline 存的是 [[lat, lng], ...] 格式,polygonAreaM2 期望 [[lng, lat], ...]
 * - 转换后调用 utils/geo 里的现成函数(已经在 store.loadAll 用过,行为稳定)
 */
const areaM2 = computed(() => {
  if (!unit.value?.polyline || unit.value.polyline.length < 3) return '—'
  const ring = unit.value.polyline.map(([lat, lng]) => [lng, lat] as [number, number])
  return Math.round(polygonAreaM2(ring)).toLocaleString('zh-CN')
})

/** Haversine 公式算两点球面距离(m),用于累加 polyline 各段长度 */
function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 管道长度(m) —— 累加 polyline 相邻两点距离 */
const pipeLengthM = computed(() => {
  if (!unit.value?.polyline || unit.value.polyline.length < 2) return '—'
  let total = 0
  const ring = unit.value.polyline  // [[lat, lng], ...]
  for (let i = 1; i < ring.length; i++) {
    const [lat1, lng1] = ring[i - 1]
    const [lat2, lng2] = ring[i]
    total += haversine(lng1, lat1, lng2, lat2)
  }
  return Math.round(total).toLocaleString('zh-CN')
})

function getItemStatus(code: string): string {
  if (!unit.value) return 'pending'
  return store.getItemStatus(unit.value.id, code)
}

function itemStatusLabel(status: string): string {
  return STATUS_LABELS[status] || '待开始'
}
</script>

<template>
  <Transition name="slide-right" mode="out-in" appear>
    <!--
      :key="unit.id" 让 Vue 把每次切换当成不同元素,触发 leave + enter(默认 v-if 不变 Vue 不重渲)
      mode="out-in" 让 leave 完才 enter,避免新旧卡片重叠
      appear: 首次挂载也跑 enter 动画(组件常驻后首次 v-if=true)
      v-if: 由 visible prop + store.selectedUnit 共同控制(visible=false 时 leave 动画能跑)
    -->
    <aside v-if="visible && unit" :key="unit.id" class="unit-info-card">
    <!-- Header：单元名 + 地址 -->
    <header class="info-header">
      <div class="info-name">{{ unit.name }}</div>
      <div class="info-address">
        <svg viewBox="0 0 24 24" width="12" height="12" class="info-address-icon">
          <path d="M12 2 C7.6 2 4 5.6 4 10 C4 14 12 22 12 22 C12 22 20 14 20 10 C20 5.6 16.4 2 12 2 Z"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <span>{{ unit.address || '—' }}</span>
      </div>
    </header>

    <!-- 进度环 + 状态 -->
    <section class="info-progress">
      <div
        class="info-ring"
        :style="{ '--pct': progressPct + '%', '--ring-color': statusColor }"
      >
        <span class="info-ring-num">{{ progressPct }}%</span>
      </div>
      <div class="info-status">
        <span class="info-status-dot" :style="{ background: statusColor }"></span>
        <span class="info-status-text">{{ statusText }}</span>
      </div>
    </section>

    <!-- 进度文字 -->
    <div class="info-progress-text">
      9 项检测 <strong>{{ completedCount }}</strong> / 9 完成
    </div>

    <!-- 基础属性：单元的物理/空间信息(给领导汇报"这个单元有多大、多长") -->
    <section class="info-attrs">
      <div class="info-attrs-grid">
        <div class="info-attr-cell">
          <div class="info-attr-label">单元面积</div>
          <div class="info-attr-value">{{ areaM2 }} <small>m²</small></div>
        </div>
        <div class="info-attr-cell">
          <div class="info-attr-label">管道长度</div>
          <div class="info-attr-value">{{ pipeLengthM }} <small>m</small></div>
        </div>
        <div class="info-attr-cell">
          <div class="info-attr-label">引入口</div>
          <div class="info-attr-value">{{ inletCount }} <small>个</small></div>
        </div>
        <div class="info-attr-cell">
          <div class="info-attr-label">绝缘接头</div>
          <div class="info-attr-value">{{ jointCount }} <small>个</small></div>
        </div>
        <div class="info-attr-cell">
          <div class="info-attr-label">起点里程</div>
          <div class="info-attr-value">{{ unit.start_mileage ?? '—' }} <small>m</small></div>
        </div>
        <div class="info-attr-cell">
          <div class="info-attr-label">终点里程</div>
          <div class="info-attr-value">{{ unit.end_mileage ?? '—' }} <small>m</small></div>
        </div>
      </div>
    </section>

    <!-- 底部按钮 -->
    <footer class="info-footer">
      <button class="info-detail-btn" @click="emit('open-detail')">
        查看完整录入
        <span class="info-detail-arrow">→</span>
      </button>
    </footer>
    </aside>
  </Transition>
</template>
