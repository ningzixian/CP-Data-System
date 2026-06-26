<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useCpStore } from '@/stores/cp'
import StatusTag from './StatusTag.vue'
import type { CorrosionUnit } from '@/types/models'

const props = defineProps<{ unit: CorrosionUnit }>()
const emit = defineEmits<{
  (e: 'select', u: CorrosionUnit): void
  (e: 'detail', u: CorrosionUnit): void
}>()
const store = useCpStore()

const completed = computed(() => Math.round(props.unit.inspection_progress * 9))
const isActive = computed(() => store.selectedUnit?.id === props.unit.id)
const jointCount = computed(() => store.unitJointCount(props.unit.id))
const inletCount = computed(() => store.unitInletCount(props.unit.id))

function click() {
  store.selectUnit(props.unit)
  emit('select', props.unit)
}

function openDetail() {
  store.selectUnit(props.unit)
  emit('detail', props.unit)
}
</script>

<template>
  <div
    class="unit-card"
    :class="{ active: isActive }"
    @click="click"
    @dblclick="openDetail"
    @mouseenter="store.hoverUnit(unit)"
    @mouseleave="store.hoverUnit(null)"
  >
    <div class="name">
      <span>{{ unit.name }}</span>
      <StatusTag :status="unit.inspection_status" />
    </div>
    <div class="addr">📍 {{ unit.address || '—' }}</div>
    <div class="progress-bar">
      <el-progress
        :percentage="Math.round(unit.inspection_progress * 100)"
        :stroke-width="8"
        :show-text="true"
        :status="unit.inspection_status === 'exception' ? 'exception' : (unit.inspection_status === 'completed' ? 'success' : '')"
      />
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#606266">
      <span>9 项检测 {{ completed }} / 9</span>
      <span style="color:#909399">✕ {{ jointCount }} 接头 ｜ ● {{ inletCount }} 引入</span>
    </div>
  </div>
</template>