<script setup lang="ts">
import { computed } from 'vue'
import { useCpStore } from '@/stores/cp'
import { latestRecordsByItem } from '@/utils/inspection'
import type { InspectionItemCode, InspectionRecord } from '@/types/models'

withDefaults(defineProps<{
  visible?: boolean
  activeCode?: InspectionItemCode | null
}>(), {
  visible: false,
  activeCode: null,
})

const emit = defineEmits<{
  (e: 'return'): void
  (e: 'select', code: InspectionItemCode): void
}>()

interface ModuleConfig {
  code: InspectionItemCode
  name: string
  field: string
  unit?: string
}

const MODULE_CONFIGS: ModuleConfig[] = [
  { code: 'JOINT_VERIFY', name: '绝缘性能', field: 'insulation_resistance', unit: 'MΩ' },
  { code: 'SOIL_RESISTIVITY', name: '土壤电阻率', field: 'resistivity', unit: 'Ω·m' },
  { code: 'DC_STRAY_CURRENT', name: '直流杂散电流', field: 'current_density', unit: 'μA/cm²' },
  { code: 'COATING_DETECT', name: '防腐层检测', field: 'damage_count' },
  { code: 'PIPE_GROUND_POTENTIAL', name: '管地腐蚀电位', field: 'natural_potential', unit: 'V' },
  { code: 'ELECTRIC_CONTINUITY', name: '管道电联通性', field: 'is_connected' },
  { code: 'INLET_PARAM', name: '引入口参数', field: 'diameter', unit: 'mm' },
]

const MODULE_PALETTES = [
  { primary: '#2563eb', secondary: '#60a5fa', soft: '#dbeafe' },
  { primary: '#0f766e', secondary: '#2dd4bf', soft: '#ccfbf1' },
  { primary: '#c2410c', secondary: '#fb923c', soft: '#ffedd5' },
  { primary: '#7c3aed', secondary: '#a78bfa', soft: '#ede9fe' },
  { primary: '#0369a1', secondary: '#38bdf8', soft: '#e0f2fe' },
  { primary: '#15803d', secondary: '#4ade80', soft: '#dcfce7' },
  { primary: '#a21caf', secondary: '#e879f9', soft: '#fae8ff' },
]

const store = useCpStore()

const latestRecords = computed(() => {
  const unitId = store.selectedUnit?.id
  if (!unitId) return new Map<InspectionItemCode, InspectionRecord>()
  return latestRecordsByItem(store.records.filter((record) => record.unit_id === unitId))
})

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function formatRepresentativeValue(config: ModuleConfig, record?: InspectionRecord): string {
  if (!record) return '未检测'

  if (config.code === 'PIPE_GROUND_POTENTIAL') {
    const average = Number(record.result_data?.natural_potential ?? record.measured_value)
    if (Number.isFinite(average)) return `${average.toFixed(4)} V`
  }

  if (config.code === 'INLET_PARAM') {
    const average = Number(record.result_data?.average_diameter ?? record.result_data?.diameter ?? record.measured_value)
    if (Number.isFinite(average)) return `${average.toFixed(1)} mm`
  }

  if (record.status === 'pending') return '未检测'

  const raw = record.result_data?.[config.field]
  if (hasValue(raw)) {
    if (config.code === 'COATING_DETECT') return `${String(raw)} 处破损`
    if (config.code === 'ELECTRIC_CONTINUITY') return String(raw)
    if (config.code === 'INLET_PARAM') return `DN${String(raw)}`
    return `${String(raw)}${config.unit ? ` ${config.unit}` : ''}`
  }

  if (hasValue(record.measured_value)) {
    return `${record.measured_value}${record.unit ? ` ${record.unit}` : ''}`
  }
  return record.result_summary || (record.status === 'exception' ? '检测异常' : '已检测')
}

const modules = computed(() => MODULE_CONFIGS.map((config) => ({
  ...config,
  value: formatRepresentativeValue(config, latestRecords.value.get(config.code)),
  status: latestRecords.value.get(config.code)?.status ?? 'pending',
})))

function moduleStyle(index: number): Record<string, string> {
  const reverseIndex = MODULE_CONFIGS.length - index
  const palette = MODULE_PALETTES[index]
  return {
    '--module-enter-delay': `${index * 42}ms`,
    '--module-leave-delay': `${Math.max(0, MODULE_CONFIGS.length - 1 - index) * 42}ms`,
    '--module-stack-x': `calc(${reverseIndex * 100}% + ${reverseIndex * 10}px)`,
    '--module-stack-y': `${(index - 3) * 2}px`,
    '--module-stack-rotate': `${(index - 3.5) * 1.7}deg`,
    ...(palette ? {
      '--module-primary': palette.primary,
      '--module-secondary': palette.secondary,
      '--module-soft': palette.soft,
    } : {}),
  }
}
</script>

<template>
  <TransitionGroup
    name="module-deck"
    tag="section"
    class="unit-data-modules"
    :class="{ visible }"
    aria-label="当前控制单元数据模块"
    appear
  >
    <button
      v-for="(module, index) in visible ? modules : []"
      :key="module.code"
      type="button"
      class="unit-data-module is-enabled"
      :class="{ 'is-active': activeCode === module.code, 'is-exception': module.status === 'exception' }"
      :style="moduleStyle(index)"
      @click="emit('select', module.code)"
    >
      <span class="unit-data-module-icon" aria-hidden="true">
        <svg v-if="module.code === 'JOINT_VERIFY'" viewBox="0 0 32 32">
          <circle cx="11" cy="16" r="6"/><circle class="icon-secondary" cx="21" cy="16" r="6"/><path d="M14 16h4"/>
        </svg>
        <svg v-else-if="module.code === 'SOIL_RESISTIVITY'" viewBox="0 0 32 32">
          <path d="M5 10c5-3 9 3 14 0s6-1 8 0M5 16c5-3 9 3 14 0s6-1 8 0M5 22c5-3 9 3 14 0s6-1 8 0"/>
        </svg>
        <svg v-else-if="module.code === 'DC_STRAY_CURRENT'" viewBox="0 0 32 32">
          <path d="M18 3 8 18h8l-2 11 10-16h-8l2-10Z"/><path class="icon-secondary" d="M7 8H4m24 16h-3"/>
        </svg>
        <svg v-else-if="module.code === 'COATING_DETECT'" viewBox="0 0 32 32">
          <path d="M16 3 26 7v8c0 7-4 11-10 14C10 26 6 22 6 15V7l10-4Z"/><path class="icon-secondary" d="m11 16 3 3 7-7"/>
        </svg>
        <svg v-else-if="module.code === 'PIPE_GROUND_POTENTIAL'" viewBox="0 0 32 32">
          <path d="M4 18c4-12 8 12 12 0s8 12 12 0"/><path class="icon-secondary" d="M4 26h24"/>
        </svg>
        <svg v-else-if="module.code === 'ELECTRIC_CONTINUITY'" viewBox="0 0 32 32">
          <circle class="icon-secondary" cx="7" cy="16" r="3"/><circle class="icon-secondary" cx="25" cy="16" r="3"/><path d="M10 16h12M16 10v12"/>
        </svg>
        <svg v-else viewBox="0 0 32 32">
          <path d="M4 12h14v8H4zM18 9h4v14h-4z"/><path class="icon-secondary" d="M22 12h6v8h-6zM8 12V8m6 4V8"/>
        </svg>
      </span>
      <span class="unit-data-module-copy">
        <span class="unit-data-module-name">{{ module.name }}</span>
        <span class="unit-data-module-value">{{ module.value }}</span>
      </span>
      <span v-if="module.status === 'exception'" class="unit-data-module-status">异常</span>
    </button>

    <button
      v-if="visible"
      key="RETURN"
      type="button"
      class="unit-data-module is-return"
      :style="moduleStyle(7)"
      @click="emit('return')"
    >
      <span class="unit-data-module-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="m14 7-9 9 9 9"/><path d="M6 16h13c5 0 8 3 8 8"/>
        </svg>
      </span>
      <span class="unit-data-module-copy">
        <span class="unit-data-module-name">返回</span>
        <span class="unit-data-module-value">单元信息卡片</span>
      </span>
    </button>
  </TransitionGroup>
</template>
