<script setup lang="ts">
/**
 * 数据看板（重写版）
 *
 * 整合两个数据源：
 *  - public/data/：GIS 导出的管线、调压箱、引入口和接头
 *  - public/data/topology/：物探数据（管径、材质、压力、建设年代和权属）
 *
 * 4 个模块（tab 切换）：
 *  - 概览  综合 KPI + 4 个图表
 *  - 管网  管线/设施 + 物探 6 维度
 *  - 检测  异常分析 + 检测员表现
 *  - 进度  7 项检测完成度（保留原内容）
 *
 * 数据范围：全部 / 七里 / 三里 / 六里
 */
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { loadZhiwenNetworkData, projectCpData } from '@/zhiwen/dataLoader'
import { useCpStore } from '@/stores/cp'
import { communityOfUnit } from '@/utils/community'
import type { ZhiwenData } from '@/zhiwen/engine'
import DashboardOverview from './modules/DashboardOverview.vue'
import DashboardNetwork from './modules/DashboardNetwork.vue'
import DashboardInspection from './modules/DashboardInspection.vue'
import DashboardProgress from './modules/DashboardProgress.vue'
import DashboardSql from './modules/DashboardSql.vue'

const store = useCpStore()
const activeTab = ref<'overview' | 'network' | 'inspection' | 'progress' | 'sql'>('overview')
const community = ref('全部')
const dataLoading = ref(true)
const data = ref<ZhiwenData>({
  pipes: [], inlets: [], controls: [], joints: [], regulators: [],
  units: [], records: [], communities: [],
  topology: null,
})

const communities = computed(() => [
  '全部',
  ...new Set([
    ...data.value.communities,
    ...data.value.units.map((unit) => unit.community).filter(Boolean),
  ]),
])

async function loadAll() {
  dataLoading.value = true
  try {
    const [net] = await Promise.all([
      loadZhiwenNetworkData(),
      store.loadAll(),
    ])
    const communityByUnit = Object.fromEntries(store.units.map((unit) => [unit.id, communityOfUnit(unit)]))
    const cp = projectCpData(store.units as any, store.records as any, communityByUnit)
    data.value = {
      pipes: net.pipes,
      inlets: net.inlets,
      controls: net.controls,
      joints: net.joints,
      regulators: net.regulators,
      units: cp.units,
      records: cp.records,
      communities: net.communities,
      topology: net.topology,
    }
    // 数据加载完提示
    if (net.topology) {
      ElMessage.success(`已加载：${net.pipes.length} 条管线（GIS + 物探 ${net.topology.rawLines.length}）、${cp.records.length} 条检测记录、${cp.units.length} 个腐控单元`)
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('数据加载失败：' + (e as Error).message)
  } finally {
    dataLoading.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="page-container" v-loading="dataLoading">
    <!-- 头部标题 + 数据范围选择 -->
    <div class="db-header">
      <div class="db-title">
        <span style="font-size:20px;font-weight:600">📊 数据看板</span>
        <el-tag size="small" type="info" effect="plain">整合 GIS + 物探 + 检测</el-tag>
      </div>
      <div class="db-controls">
        <span class="ctrl-label">数据范围：</span>
        <el-radio-group v-model="community" size="default">
          <el-radio-button v-for="c in communities" :key="c" :label="c">
            {{ c === '全部' ? '全部小区' : c.replace('南海家园', '') }}
          </el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 模块 tab -->
    <el-tabs v-model="activeTab" class="db-tabs">
      <el-tab-pane label="📊 概览" name="overview">
        <DashboardOverview :data="data" :community="community" />
      </el-tab-pane>
      <el-tab-pane label="🔧 管网 + 物探" name="network">
        <DashboardNetwork :data="data" :community="community" />
      </el-tab-pane>
      <el-tab-pane label="📋 检测与异常" name="inspection">
        <DashboardInspection :data="data" :community="community" />
      </el-tab-pane>
      <el-tab-pane label="🎯 检测进度" name="progress">
        <DashboardProgress :data="data" :community="community" />
      </el-tab-pane>
      <el-tab-pane label="🗄️ SQL 统计" name="sql">
        <DashboardSql />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.page-container { padding: 16px 24px 32px; }

.db-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  background: #fff;
  padding: 16px 20px;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  flex-wrap: wrap;
  gap: 12px;
}

.db-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.db-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ctrl-label {
  font-size: 13px;
  color: #606266;
  font-weight: 500;
}

.db-tabs {
  background: #fff;
  border-radius: 8px;
  padding: 4px 20px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

:deep(.el-tabs__nav-wrap) { margin-left: 0; }
:deep(.el-tabs__item) { font-size: 14px; height: 44px; line-height: 44px; }
:deep(.el-tabs__content) { padding-top: 8px; }
</style>
