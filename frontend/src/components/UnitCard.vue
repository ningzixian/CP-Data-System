<script setup lang="ts">
import { computed } from 'vue'
import { useCpStore } from '@/stores/cp'
import StatusTag from './StatusTag.vue'
import type { CorrosionUnit } from '@/types/models'

const props = defineProps<{ unit: CorrosionUnit }>()
const emit = defineEmits<{
  (e: 'select', u: CorrosionUnit): void
}>()
const store = useCpStore()

const itemCount = computed(() => store.items.length)
const completed = computed(() => Math.round(props.unit.inspection_progress * itemCount.value))
const isActive = computed(() => store.selectedUnit?.id === props.unit.id)
const jointCount = computed(() => store.unitJointCount(props.unit.id))
const inletCount = computed(() => store.unitInletCount(props.unit.id))

/** 进度条自定义颜色函数（按单元状态 + 进度分档，全部用 color 不用 status 避免内置图标）
 *  - exception → 红 #f56c6c（异常优先）
 *  - 100%      → 绿 #67c23a
 *  - 80-99%    → 橙 #e6a23c（即将完成）
 *  - 1-79%     → 蓝 #409eff
 *  - 0%        → 浅灰 #909399
 */
function progressColor(percentage: number): string {
  if (props.unit.inspection_status === 'exception') return '#f56c6c'
  if (percentage >= 100) return '#67c23a'
  if (percentage > 80) return '#e6a23c'
  if (percentage > 0) return '#409eff'
  return '#909399'
}

function click() {
  // 只 emit：选中逻辑交给 MapPage.selectUnit 处理（带 toggle 语义）
  // 这里不再 store.selectUnit，避免 MapPage.toggle 误判为"重复点同一单元"
  emit('select', props.unit)
}

</script>

<template>
  <div
    class="unit-card"
    :class="{ active: isActive }"
    :data-unit-id="unit.id"
    @click="click"
    @mouseenter="store.hoverUnit(unit)"
    @mouseleave="store.hoverUnit(null)"
  >
    <div class="name">
      <span>{{ unit.name }}</span>
      <StatusTag :status="unit.inspection_status" />
    </div>
    <div class="addr">
      <svg class="location-icon" viewBox="0 0 24 24" width="12" height="12">
        <path d="M12 2 C7.6 2 4 5.6 4 10 C4 14 12 22 12 22 C12 22 20 14 20 10 C20 5.6 16.4 2 12 2 Z"
              fill="none" stroke="#909399" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="12" cy="10" r="2.5" fill="none" stroke="#909399" stroke-width="2"/>
      </svg>
      <span>{{ unit.address || '—' }}</span>
    </div>
    <div class="progress-bar">
      <el-progress
        :percentage="Math.round(unit.inspection_progress * 100)"
        :stroke-width="8"
        :show-text="true"
        :status="Math.round(unit.inspection_progress * 100) >= 100 ? 'success' : ''"
        :color="progressColor"
      />
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#606266">
      <span>{{ itemCount }} 项检测 {{ completed }} / {{ itemCount }}</span>
      <span style="color:#909399">✕ {{ jointCount }} 接头 ｜ ● {{ inletCount }} 引入</span>
    </div>
  </div>
</template>
