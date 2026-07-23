/**
 * 通用轮询 composable
 *
 * 用法：
 *   const { data, error, refresh, stop } = usePolling(
 *     () => fieldApi.listTasks(),
 *     { interval: 5000, immediate: true }
 *   )
 *
 * 特性：
 *   - 间隔可配（默认 5000ms）
 *   - immediate: true 时挂载立即拉一次
 *   - 错误不打断轮询（打印到 console，下一轮再试）
 *   - 组件卸载时自动 stop
 *   - 暴露 pause() / resume() / refresh() 手动控制
 */
import { ref, computed, onUnmounted, type Ref, type ComputedRef } from 'vue'

export interface UsePollingOptions {
  /** 轮询间隔，毫秒，默认 5000 */
  interval?: number
  /** 挂载时是否立即拉一次，默认 true */
  immediate?: boolean
  /** 是否启用，默认 true；设为 false 时不会启动 */
  enabled?: boolean
}

export interface UsePollingReturn<T> {
  /** 当前数据（可能为 null，computed 解包） */
  data: ComputedRef<T | null>
  error: Ref<Error | null>
  loading: Ref<boolean>
  /** 立即拉一次 */
  refresh: () => Promise<void>
  /** 暂停轮询（不清 data） */
  pause: () => void
  /** 恢复轮询（立即拉一次） */
  resume: () => void
  /** 停止轮询并清空 data（一般组件卸载时自动调） */
  stop: () => void
  /** 是否在轮询中 */
  running: Ref<boolean>
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: UsePollingOptions = {},
): UsePollingReturn<T> {
  const interval = options.interval ?? 5000
  const _data: Ref<T | null> = ref(null)
  const data = computed(() => _data.value)
  const error = ref<Error | null>(null)
  const loading = ref(false)
  const running = ref(false)

  let timer: number | null = null
  let stopped = false
  let paused = false

  async function refresh() {
    if (stopped) return
    loading.value = true
    try {
      const v = await fetcher()
      _data.value = v
      error.value = null
    } catch (e) {
      error.value = e as Error
      // 不打断轮询
      console.warn('[usePolling] fetch failed:', e)
    } finally {
      loading.value = false
    }
  }

  function tick() {
    if (stopped || paused) return
    void refresh()
  }

  function start() {
    if (running.value || stopped) return
    running.value = true
    if (options.immediate !== false) {
      void refresh()
    }
    timer = window.setInterval(tick, interval)
  }

  function stop() {
    stopped = true
    running.value = false
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  function pause() {
    paused = true
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  function resume() {
    if (paused && !stopped) {
      paused = false
      start()
    }
  }

  if (options.enabled !== false) {
    start()
  }

  onUnmounted(stop)

  return { data, error, loading, refresh, pause, resume, stop, running }
}
