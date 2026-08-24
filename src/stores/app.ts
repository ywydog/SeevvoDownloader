/**
 * @fileoverview Pinia store for global application state: engine, tasks, stats, and polling.
 *
 * Global stat (speed / task counts) follows a Backend-as-Source-of-Truth architecture:
 *   Rust stat_service  ──500ms──▶  aria2 getGlobalStat
 *                      ├──▶  tray / dock / progress (direct native API)
 *                      └──▶  emit("stat:update")  ──▶  this store
 *
 * The frontend does NOT poll aria2 for global stats — it passively listens
 * to the Rust event stream. This eliminates double RPC and redundant IPC.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { STAT_BASE_INTERVAL, STAT_PER_TASK_INTERVAL, STAT_MIN_INTERVAL, STAT_MAX_INTERVAL } from '@shared/timing'
import type { Aria2EngineOptions, AppConfig, TauriUpdate } from '@shared/types'

/** Payload shape emitted by Rust stat_service via `stat:update`. */
interface StatPayload {
  downloadSpeed: number
  uploadSpeed: number
  numActive: number
  numWaiting: number
  numStopped: number
  numStoppedTotal: number
}

export const useAppStore = defineStore('app', () => {
  const systemTheme = ref('light')
  const trayFocused = ref(false)
  const aboutPanelVisible = ref(false)
  const engineInfo = ref<{ version: string; enabledFeatures: string[] }>({
    version: '',
    enabledFeatures: [],
  })
  const engineOptions = ref<Partial<AppConfig>>({})
  const interval = ref(STAT_BASE_INTERVAL)
  const stat = ref({
    downloadSpeed: 0,
    uploadSpeed: 0,
    numActive: 0,
    numWaiting: 0,
    numStopped: 0,
    numStoppedTotal: 0,
  })
  const addTaskVisible = ref(false)
  const addTaskOptions = ref<Aria2EngineOptions>({})
  const progress = ref(0)
  const pendingUpdate = ref<TauriUpdate | null>(null)
  const engineRestarting = ref(true)
  let engineRestartingSince = Date.now()
  const MIN_BANNER_MS = 1000

  /** Set engine restarting state with minimum display time to prevent flicker. */
  function setEngineRestarting(value: boolean) {
    if (value) {
      engineRestarting.value = true
      engineRestartingSince = Date.now()
    } else {
      const elapsed = Date.now() - engineRestartingSince
      const remaining = MIN_BANNER_MS - elapsed
      if (remaining > 0) {
        setTimeout(() => {
          engineRestarting.value = false
        }, remaining)
      } else {
        engineRestarting.value = false
      }
    }
  }
  const engineReady = ref(false)

  function updateInterval(millisecond: number) {
    let val = millisecond
    if (val > STAT_MAX_INTERVAL) val = STAT_MAX_INTERVAL
    if (val < STAT_MIN_INTERVAL) val = STAT_MIN_INTERVAL
    if (interval.value === val) return
    interval.value = val
  }

  function increaseInterval(millisecond = 100) {
    if (interval.value < STAT_MAX_INTERVAL) interval.value += millisecond
  }

  /** Opens an empty add-task dialog for manual URI entry. */
  function showAddTaskDialog() {
    addTaskVisible.value = true
  }

  function hideAddTaskDialog() {
    addTaskVisible.value = false
  }

  function updateAddTaskOptions(options: Aria2EngineOptions = {}) {
    addTaskOptions.value = { ...options }
  }

  /**
   * Processes a single stat:update event payload from the Rust backend.
   * Updates reactive stat values AND the adaptive polling interval that
   * TaskView's list refresh depends on.
   */
  function handleStatEvent(payload: StatPayload) {
    const { numActive } = payload
    stat.value = {
      downloadSpeed: numActive > 0 ? payload.downloadSpeed : 0,
      uploadSpeed: payload.uploadSpeed,
      numActive,
      numWaiting: payload.numWaiting,
      numStopped: payload.numStopped,
      numStoppedTotal: payload.numStoppedTotal,
    }
    if (numActive > 0) {
      updateInterval(STAT_BASE_INTERVAL - STAT_PER_TASK_INTERVAL * numActive)
    } else {
      increaseInterval()
    }
  }

  /**
   * Subscribes to the Rust stat_service's `stat:update` event stream.
   * Returns an unlisten function for cleanup.
   */
  function setupStatListener(): Promise<() => void> {
    return listen<StatPayload>('stat:update', (event) => {
      handleStatEvent(event.payload)
    })
  }

  async function fetchEngineInfo(api: { getVersion: () => Promise<{ version: string; enabledFeatures: string[] }> }) {
    const data = await api.getVersion()
    engineInfo.value = { ...engineInfo.value, ...data }
  }

  async function fetchEngineOptions(api: { getGlobalOption: () => Promise<Record<string, string>> }) {
    const data = await api.getGlobalOption()
    engineOptions.value = { ...engineOptions.value, ...data }
    return data
  }

  return {
    systemTheme,
    trayFocused,
    aboutPanelVisible,
    engineInfo,
    engineOptions,
    interval,
    stat,
    addTaskVisible,
    addTaskOptions,
    progress,
    pendingUpdate,
    engineRestarting,
    setEngineRestarting,
    engineReady,
    updateInterval,
    increaseInterval,
    showAddTaskDialog,
    hideAddTaskDialog,
    updateAddTaskOptions,
    handleStatEvent,
    setupStatListener,
    fetchEngineInfo,
    fetchEngineOptions,
  }
})
