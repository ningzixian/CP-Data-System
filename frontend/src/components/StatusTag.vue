<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_LABELS, STATUS_COLORS } from '@/types/items'

const props = defineProps<{ status: string; short?: boolean }>()

const label = computed(() =>
  props.short
    ? { pending: '○', in_progress: '…', passed: '✓', exception: '✗', completed: '✓' }[props.status] || '—'
    : STATUS_LABELS[props.status] || '—',
)
const color = computed(() => STATUS_COLORS[props.status] || '#909399')
</script>

<template>
  <span class="status-tag" :class="`status-${status}`">{{ label }}</span>
</template>