<script setup lang="ts">
import { ref, computed } from 'vue'
import { useCpStore } from '@/stores/cp'
import MapView from '@/components/MapView.vue'
import UnitCard from '@/components/UnitCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import InspectionForm from '@/components/InspectionForm.vue'
import type { CorrosionUnit } from '@/types/models'

const store = useCpStore()
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

const drawerOpen = ref(false)
const activeTab = ref('')
// 小区折叠面板：默认展开（['nanhai'] 表示展开，[] 表示收起）
const communityActive = ref<string[]>(['nanhai'])

function selectUnit(u: CorrosionUnit) {
  store.selectUnit(u)
  // 单击只选中，不开抽屉
}

function openDetail(u: CorrosionUnit) {
  store.selectUnit(u)
  drawerOpen.value = true
  activeTab.value = store.items[0]?.code || ''
  mapRef.value?.flyTo(u)
}

function onDrawerClosed() {
  store.selectUnit(null)
}

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

      <!-- 小区分组（可折叠，带过渡动效） -->
      <el-collapse v-model="communityActive" class="community-collapse">
        <el-collapse-item name="nanhai">
          <template #title>
            <span class="community-header">
              <span class="name">南海家园七里</span>
              <span class="meta">{{ store.units.length }} 个单元</span>
            </span>
          </template>
          <UnitCard v-for="u in store.units" :key="u.id" :unit="u" @select="selectUnit" @detail="openDetail" />
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="map-panel">
      <MapView ref="mapRef" :units="store.units" :points="store.points" @select="selectUnit" @detail="openDetail" />
      <div class="map-legend">
        <div><span class="dot" style="background:#67c23a"></span>已完成</div>
        <div><span class="dot" style="background:#e6a23c"></span>进行中</div>
        <div><span class="dot" style="background:#909399"></span>待开始</div>
        <div><span class="dot" style="background:#f56c6c"></span>异常</div>
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid #ebeef5">
          <span style="display:inline-block;width:14px;height:10px;background:rgba(103,194,58,0.18);border:1.5px dashed #67c23a;vertical-align:middle;margin-right:6px"></span>低压制控制单元
        </div>
        <div>
          <span style="display:inline-block;width:18px;height:0;border-top:3px solid #67c23a;vertical-align:middle;margin-right:6px"></span>低压燃气管道
        </div>
        <div><span style="color:#f56c6c;font-weight:900;font-size:14px;margin-right:4px">✕</span>绝缘接头</div>
        <div><span style="display:inline-block;width:14px;height:14px;background:#1890ff;border-radius:3px;vertical-align:middle;margin-right:6px;color:#fff;font-size:10px;text-align:center;line-height:14px">调</span>调压箱</div>
        <div><span style="display:inline-block;width:8px;height:8px;background:#909399;border-radius:50%;vertical-align:middle;margin-right:8px"></span>引入口</div>
      </div>
    </div>

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
          <el-descriptions-item label="中心坐标">{{ selectedUnit.lng }}, {{ selectedUnit.lat }}</el-descriptions-item>
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