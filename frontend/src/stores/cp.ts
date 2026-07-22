/**
 * 阴极保护数据系统全局状态
 *
 * 数据流：
 *   启动 → loadAll() 并发请求后端 API + 从 facilities.ts 加载真实 CSV
 *        → units / points / pipes / regulators / inlets 全部就位
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { pipelinesApi } from '@/api/pipelines'
import { fetchItems } from '@/api/items'
import { setReadonlyRecords } from '@/api/records'
import { fetchMobileDetectionData, type MobileDetectionPoint, type MobileDetectionReport, type MobileTask } from '@/api/mobileDetection'
import { loadFacilities, type FacilitiesData } from '@/utils/facilities'
import { USE_MOCK } from '@/api/client'
import { computeInspectionProgress, latestRecordsByItem } from '@/utils/inspection'
import { adaptMobileDetectionData } from '@/utils/mobileDetectionAdapter'
import { FSKZ755856_DEMO_RECORDS } from '@/mock/data'
import type {
  Pipeline, CorrosionUnit, InspectionPoint, InspectionRecord,
  DashboardData, InspectionItemDef, RecordStatus,
} from '@/types/models'

export const useCpStore = defineStore('cp', () => {
  // 业务数据
  const pipelines = ref<Pipeline[]>([])
  const records = ref<InspectionRecord[]>([])
  const dashboard = ref<DashboardData | null>(null)
  const items = ref<InspectionItemDef[]>([])
  const loading = ref(false)
  const loadError = ref('')
  const mobileTasks = ref<MobileTask[]>([])
  const mobilePoints = ref<MobileDetectionPoint[]>([])
  const mobileReports = ref<MobileDetectionReport[]>([])
  const unmatchedMobileReports = ref(0)
  let loaded = false
  let loadPromise: Promise<void> | null = null

  // 现场设施数据（来自 CSV）
  const units = ref<CorrosionUnit[]>([])
  const points = ref<InspectionPoint[]>([])
  const facilities = ref<FacilitiesData | null>(null)

  // 选中 / hover
  const selectedUnit = ref<CorrosionUnit | null>(null)
  const hoveredUnit = ref<CorrosionUnit | null>(null)

  const stats = computed(() => ({
    total: dashboard.value?.total_units ?? 0,
    completed: dashboard.value?.completed ?? 0,
    in_progress: dashboard.value?.in_progress ?? 0,
    pending: dashboard.value?.pending ?? 0,
    exception: dashboard.value?.exception ?? 0,
  }))

  /**
   * 整体加载：业务 API + 现场设施 CSV 一起拉
   * - 后端联调时（USE_MOCK=false），units/points 由后端 API 返回
   * - mock 模式下，units/points 由 public/data/ 下的 CSV 加载（不需要真实后端）
   */
  async function loadAll(force = false) {
    if (!force && loaded) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
      loading.value = true
      loadError.value = ''
      try {
        const [fac, p, its] = await Promise.all([
          loadFacilities(),
          pipelinesApi.list(),
          fetchItems(),
        ])

        facilities.value = fac
        units.value = fac.units
        pipelines.value = p
        items.value = its

        // 用真实绝缘接头生成 InspectionPoint 列表（store.points 给前端用）
        points.value = fac.joints
          .filter((j) => j.unit_id !== undefined)
          .map((j): InspectionPoint => ({
            id: j.fid,
            unit_id: j.unit_id!,
            point_type: '绝缘接头',
            lng: j.lng,
            lat: j.lat,
            mileage: 0,
            bd_coord: '',
            location_desc: `${j.type}｜${j.pressured}`,
            created_at: new Date().toISOString(),
          }))

        await loadMobileRecords()
        dashboard.value = computeDashboard()
        loaded = true
      } catch (error) {
        loadError.value = error instanceof Error ? error.message : '数据加载失败'
        console.error('[CP Store] 数据加载失败：', error)
        ElMessage.error(`数据加载失败：${loadError.value}`)
      } finally {
        loading.value = false
      }
    })()

    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  async function loadMobileRecords() {
    const mobile = await fetchMobileDetectionData()
    mobileTasks.value = mobile.tasks
    mobilePoints.value = mobile.points
    mobileReports.value = mobile.reports
    const adapted = adaptMobileDetectionData(mobile, units.value)
    unmatchedMobileReports.value = adapted.unmatchedReports

    // FSKZ755856 固定用于现场展示：该单元采用本地演示记录，其余单元采用手机端后端记录。
    // 运行时按单元编码查找 ID，避免依赖 CSV 中可能变化的内部编号。
    const showcaseUnit = units.value.find((unit) => unit.name.trim() === 'FSKZ755856')
    const backendRecords = showcaseUnit
      ? adapted.records.filter((record) => record.unit_id !== showcaseUnit.id)
      : adapted.records
    const showcaseRecords = showcaseUnit
      ? FSKZ755856_DEMO_RECORDS.map((record) => ({
          ...record,
          unit_id: showcaseUnit.id,
          result_data: structuredClone(record.result_data),
        }))
      : []
    const mergedRecords = [...backendRecords, ...showcaseRecords]

    setReadonlyRecords(mergedRecords)
    applyRecords(mergedRecords)
    if (!showcaseUnit) {
      console.warn('[CP Store] 未找到展示单元 FSKZ755856，本次未注入本地演示记录')
    }
    if (adapted.unmatchedReports > 0) {
      console.warn(`[CP Store] ${adapted.unmatchedReports} 条手机端报告因缺少任务、检测点或本地腐控单元而未展示`)
    }
  }

  function applyRecords(nextRecords: InspectionRecord[]) {
    records.value = nextRecords
    const selectedId = selectedUnit.value?.id

    // 把记录算出的进度回写到单元，同时保留当前选中单元。
    units.value = units.value.map((u) => {
      const recs = nextRecords.filter((x) => x.unit_id === u.id)
      const { progress, status } = computeInspectionProgress(recs, items.value.map((item) => item.code))
      return { ...u, inspection_progress: progress, inspection_status: status }
    })
    if (selectedId !== undefined && selectedUnit.value) {
      const updated = units.value.find((u) => u.id === selectedId)
      if (updated) Object.assign(selectedUnit.value, updated)
    }
    if (USE_MOCK) dashboard.value = computeDashboard()
  }

  async function refreshRecords() {
    await loadMobileRecords()
    dashboard.value = computeDashboard()
  }

  /**
   * 客户端计算 dashboard（mock 模式用，避免和真实 units 不一致）
   * 后端联调时此函数可不调用，走 /api/dashboard 即可
   */
  function computeDashboard(): DashboardData {
    if (!facilities.value) {
      return { total_units: 0, completed: 0, in_progress: 0, pending: 0, exception: 0, rows: [], items: [] }
    }
    const itemsDef = items.value.map((it) => ({ code: it.code, name: it.name }))
    // 用最新的 units（已经算过 progress/status）
    const rows = units.value.map((u) => {
      const recs = records.value.filter((r) => r.unit_id === u.id)
      const recMap = latestRecordsByItem(recs)
      return {
        unit_id: u.id,
        unit_name: u.name,
        lng: u.lng,
        lat: u.lat,
        progress: u.inspection_progress,
        status: u.inspection_status,
        items: itemsDef.map((it) => ({
          code: it.code,
          name: it.name,
          status: (recMap.get(it.code)?.status ?? 'pending') as RecordStatus,
        })),
      }
    })
    return {
      total_units: rows.length,
      completed: rows.filter((r) => r.status === 'completed').length,
      in_progress: rows.filter((r) => r.status === 'in_progress').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      exception: rows.filter((r) => r.status === 'exception').length,
      rows,
      items: itemsDef,
    }
  }

  function unitName(id: number) {
    return units.value.find((u) => u.id === id)?.name || `#${id}`
  }

  function getItemStatus(unitId: number, code: string) {
    const rec = [...records.value]
      .filter((r) => r.unit_id === unitId && r.item_code === code)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    return rec?.status || 'pending'
  }

  function selectUnit(u: CorrosionUnit | null) {
    selectedUnit.value = u
  }

  function hoverUnit(u: CorrosionUnit | null) {
    hoveredUnit.value = u
  }

  /** 该单元关联的绝缘接头数量 */
  function unitJointCount(unitId: number): number {
    return facilities.value?.jointCountByUnit[unitId] ?? 0
  }

  /** 该单元关联的引入口数量 */
  function unitInletCount(unitId: number): number {
    return facilities.value?.inletCountByUnit[unitId] ?? 0
  }

  return {
    pipelines, units, points, records, dashboard, items, loading, loadError,
    mobileTasks, mobilePoints, mobileReports, unmatchedMobileReports,
    facilities, selectedUnit, hoveredUnit, stats,
    loadAll, refreshRecords, unitName, getItemStatus, selectUnit, hoverUnit,
    unitJointCount, unitInletCount,
  }
})
