<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_LABELS } from '@/types/items'

const props = defineProps<{ status: string; short?: boolean }>()

const label = computed(() =>
  props.short
    ? { pending: '○', in_progress: '…', passed: '✓', exception: '✗', completed: '✓' }[props.status] || '—'
    : STATUS_LABELS[props.status] || '—',
)
</script>

<template>
  <span class="status-tag" :class="`status-${status}`">{{ label }}</span>
</template>
