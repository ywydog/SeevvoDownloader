/**
 * @fileoverview Composable encapsulating IPC event listeners for MainLayout.
 *
 * Extracted from MainLayout.vue to reduce component script size.
 * Contains handlers for: menu-event, tray-menu-action, engine-crashed,
 * engine-stopped, and drag-drop.
 */
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useRouter } from 'vue-router'
import { logger } from '@shared/logger'
import { isEngineReady } from '@/api/aria2'
import { watch, type Ref, type WatchStopHandle } from 'vue'

type PendingFrontendActionChannel = 'menu-event' | 'tray-menu-action'

interface PendingFrontendAction {
  channel: PendingFrontendActionChannel
  action: string
}

interface PortSwitchEvent {
  kind: 'rpc' | 'extensionApi'
  oldPort: number
  newPort: number
}

interface PortSwitchFailureEvent {
  kind: 'rpc' | 'extensionApi'
  port: number
  reason: 'disabled' | 'noAvailablePort' | 'bindFailed'
  source: 'startup' | 'extensionApi'
}

interface AppEventsDeps {
  t: (key: string, params?: Record<string, unknown>) => string
  appStore: {
    showAddTaskDialog: () => void
    engineReady: boolean
    engineRestarting: boolean
    addTaskVisible: boolean
  }
  taskStore: {
    hasPausedTasks: () => Promise<boolean>
    hasActiveTasks: () => Promise<boolean>
    resumeAllTask: () => Promise<unknown>
    pauseAllTask: () => Promise<unknown>
    fetchList: () => Promise<unknown>
  }
  preferenceStore: {
    pendingChanges: boolean
    saveBeforeLeave: (() => Promise<void>) | null
    config: {
      lightweightMode?: boolean
    }
    updatePreference?: (cfg: Record<string, unknown>) => void
  }
  message: {
    success: (msg: string) => void
    error: (msg: string, opts?: Record<string, unknown>) => void
    warning: (msg: string) => void
    info: (msg: string, opts?: Record<string, unknown>) => void
  }
  navDialog: ReturnType<typeof import('naive-ui').useDialog>
  showEngineOverlay: Ref<boolean>
  isExiting: Ref<boolean>
  handleExitConfirm: () => Promise<void>
  onAbout: () => void
}

interface AppEventsReturn {
  setupListeners: () => Promise<{
    unlistenDragDrop: (() => void) | null
    unlistenMenuEvent: (() => void) | null
    unlistenTrayMenu: (() => void) | null
    unlistenSingleInstance: (() => void) | null
    teardown: () => void
  }>
}

export function useAppEvents(deps: AppEventsDeps): AppEventsReturn {
  const {
    t,
    appStore,
    taskStore,
    preferenceStore,
    message,
    navDialog,
    showEngineOverlay,
    isExiting,
    handleExitConfirm,
  } = deps

  const router = useRouter()
  const cleanupFns: Array<() => void> = []
  let engineRecoveredWaitInFlight = false

  function registerCleanup(cleanup: (() => void) | null | undefined): () => void {
    let active = true
    const once = () => {
      if (!active || !cleanup) return
      active = false
      cleanup()
    }
    cleanupFns.push(once)
    return once
  }

  function teardown() {
    const pending = cleanupFns.splice(0)
    for (const cleanup of pending.reverse()) {
      cleanup()
    }
  }

  // ─── Engine lifecycle watchers ────────────────────────────────────
  async function setupEngineWatchers() {
    const unlistenEngineCrashed = registerCleanup(
      await listen<{ code: number; signal?: number }>('engine-crashed', (event) => {
        if (isExiting.value) return
        const { code } = event.payload
        logger.error('MainLayout', `engine crashed with code ${code}`)
        appStore.engineReady = false
        showEngineOverlay.value = true
      }),
    )

    const stopEngineWatch: WatchStopHandle = watch(
      () => appStore.engineRestarting,
      (initializing) => {
        if (!initializing) {
          if (appStore.engineReady) {
            message.success(t('app.engine-ready'))
          } else {
            message.error(t('app.engine-failed'), { closable: true })
            showEngineOverlay.value = true
          }
        }
      },
    )
    const unwatchEngineState = registerCleanup(stopEngineWatch)

    const unlistenEngineRecovered = registerCleanup(
      await listen<{ source: string }>('engine-recovered', async () => {
        if (engineRecoveredWaitInFlight) {
          logger.debug('MainLayout', 'engine-recovered: readiness check already in flight, skipping')
          return
        }
        engineRecoveredWaitInFlight = true
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const ready = await invoke<boolean>('wait_for_engine')
          if (ready) {
            appStore.engineReady = true
            message.success(t('app.engine-recovered'))
          } else {
            logger.error('MainLayout', 'engine-recovered: wait_for_engine returned false')
            appStore.engineReady = false
          }
        } catch (e) {
          logger.error('MainLayout', `engine-recovered: wait_for_engine failed: ${e}`)
          appStore.engineReady = false
        } finally {
          engineRecoveredWaitInFlight = false
        }
      }),
    )

    const unlistenEngineStopped = registerCleanup(
      await listen('engine-stopped', () => {
        message.warning(t('app.engine-stopped'))
      }),
    )

    const unlistenPortAutoSwitched = registerCleanup(
      await listen<PortSwitchEvent[]>('port-auto-switched', (event) => {
        const switches = event.payload
        if (!Array.isArray(switches) || switches.length === 0) return
        const labels: Record<PortSwitchEvent['kind'], string> = {
          rpc: t('preferences.rpc-listen-port'),
          extensionApi: t('preferences.extension-api-port'),
        }
        const ports = switches
          .map((item) => `${labels[item.kind] ?? item.kind} ${item.oldPort} -> ${item.newPort}`)
          .join(', ')
        const patch: Record<string, number> = {}
        for (const item of switches) {
          if (item.kind === 'rpc') patch.rpcListenPort = item.newPort
          if (item.kind === 'extensionApi') patch.extensionApiPort = item.newPort
        }
        preferenceStore.updatePreference?.(patch)
        message.info(t('preferences.port-auto-switched', { ports }))
      }),
    )

    const unlistenPortAutoSwitchFailed = registerCleanup(
      await listen<PortSwitchFailureEvent>('port-auto-switch-failed', (event) => {
        const failure = event.payload
        if (!failure || typeof failure.port !== 'number') return
        const labels: Record<PortSwitchFailureEvent['kind'], string> = {
          rpc: t('preferences.rpc-listen-port'),
          extensionApi: t('preferences.extension-api-port'),
        }
        const params = {
          label: labels[failure.kind] ?? failure.kind,
          port: failure.port,
        }
        if (failure.reason === 'disabled') {
          message.warning(t('preferences.port-auto-switch-disabled', params))
          return
        }
        if (failure.reason === 'noAvailablePort') {
          message.error(t('preferences.port-auto-switch-no-available-port', params), { closable: true })
          return
        }
        message.error(t('preferences.port-auto-switch-bind-failed', params), { closable: true })
      }),
    )

    return {
      unlistenEngineCrashed,
      unwatchEngineState,
      unlistenEngineRecovered,
      unlistenEngineStopped,
      unlistenPortAutoSwitched,
      unlistenPortAutoSwitchFailed,
    }
  }

  // ─── Navigation guard ─────────────────────────────────────────────
  function setupNavGuard() {
    return registerCleanup(
      router.beforeEach((to, from) => {
        const leavingPrefs = from.path.startsWith('/preference') && !to.path.startsWith('/preference')
        const switchingPrefsTab =
          from.path.startsWith('/preference') && to.path.startsWith('/preference') && from.path !== to.path
        if ((leavingPrefs || switchingPrefsTab) && preferenceStore.pendingChanges) {
          return new Promise<boolean>((resolve) => {
            navDialog.warning({
              title: t('preferences.not-saved'),
              content: t('preferences.not-saved-confirm'),
              positiveText: t('preferences.save-and-leave'),
              negativeText: t('preferences.leave-without-saving'),
              onPositiveClick: async () => {
                try {
                  if (preferenceStore.saveBeforeLeave) {
                    await preferenceStore.saveBeforeLeave()
                  }
                  preferenceStore.pendingChanges = false
                  resolve(true)
                } catch (e) {
                  logger.error('NavGuard', e)
                  resolve(false)
                }
              },
              onNegativeClick: () => {
                preferenceStore.pendingChanges = false
                resolve(true)
              },
              onClose: () => {
                resolve(false)
              },
              onMaskClick: () => {
                resolve(false)
              },
            })
          })
        }
        return true
      }),
    )
  }

  // ─── Native menu events (macOS menu bar) ──────────────────────────
  async function setupMenuListener() {
    return registerCleanup(
      await listen<string>('menu-event', async (event) => {
        await handleMenuAction(event.payload)
      }),
    )
  }

  // ─── Tray menu actions (system-tray right-click menu) ──────────────
  async function setupTrayListener() {
    return registerCleanup(
      await listen<string>('tray-menu-action', async (event) => {
        await handleTrayAction(event.payload)
      }),
    )
  }

  async function surfaceMainWindow() {
    const mainWindow = getCurrentWindow()
    await mainWindow.unminimize()
    await mainWindow.show()
    await mainWindow.setFocus()
  }

  async function handleMenuAction(action: string) {
    switch (action) {
      case 'about':
        deps.onAbout()
        break
      case 'new-task':
        await surfaceMainWindow()
        appStore.showAddTaskDialog()
        break
      case 'preferences':
        router.push('/preference').catch(() => {
          /* duplicate navigation */
        })
        break
      case 'resume-all':
        if (!(await taskStore.hasPausedTasks())) break
        taskStore.resumeAllTask().catch((e) => logger.error('TrayMenu', e))
        break
      case 'pause-all':
        if (!(await taskStore.hasActiveTasks())) break
        taskStore.pauseAllTask().catch((e) => logger.error('TrayMenu', e))
        break
      case 'release-notes':
        openUrl('https://github.com/AnInsomniacy/motrix-next/releases').catch((e) => logger.error('TrayMenu', e))
        break
      case 'report-issue':
        openUrl('https://github.com/AnInsomniacy/motrix-next/issues').catch((e) => logger.error('TrayMenu', e))
        break
    }
  }

  async function handleTrayAction(action: string) {
    switch (action) {
      case 'show':
        await surfaceMainWindow()
        break
      case 'new-task':
        await surfaceMainWindow()
        appStore.showAddTaskDialog()
        break
      case 'resume-all':
        await surfaceMainWindow()
        if (!(await taskStore.hasPausedTasks())) {
          message.info(t('task.no-paused-tasks'))
          break
        }
        if (!isEngineReady()) {
          message.warning(t('app.engine-not-ready'))
        } else {
          navDialog.warning({
            title: t('task.resume-all-task'),
            content: t('task.resume-all-task-confirm') || 'Resume all tasks?',
            positiveText: t('app.yes'),
            negativeText: t('app.no'),
            onPositiveClick: () => {
              taskStore
                .resumeAllTask()
                .then(() => message.success(t('task.resume-all-task-success')))
                .catch(() => message.error(t('task.resume-all-task-fail')))
            },
          })
        }
        break
      case 'pause-all': {
        await surfaceMainWindow()
        if (!(await taskStore.hasActiveTasks())) {
          message.info(t('task.no-active-tasks'))
          break
        }
        if (!isEngineReady()) {
          message.warning(t('app.engine-not-ready'))
          break
        }
        const d = navDialog.warning({
          title: t('task.pause-all-task'),
          content: t('task.pause-all-task-confirm') || 'Pause all tasks?',
          positiveText: t('app.yes'),
          negativeText: t('app.no'),
          onPositiveClick: () => {
            d.loading = true
            d.negativeButtonProps = { disabled: true }
            d.closable = false
            d.maskClosable = false
            taskStore
              .pauseAllTask()
              .then(async () => {
                await new Promise((r) => setTimeout(r, 500))
                await taskStore.fetchList()
                message.success(t('task.pause-all-task-success'))
                d.destroy()
              })
              .catch(() => {
                message.error(t('task.pause-all-task-fail'))
                d.destroy()
              })
            return false
          },
        })
        break
      }
      case 'quit':
        await handleExitConfirm()
        break
    }
  }

  // ─── Drag & drop files ──────────────────────────────────────────
  async function setupDragDropListener() {
    const webview = getCurrentWebview()
    return registerCleanup(
      await webview.onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths
          const validPaths = paths?.filter((p: string) => isValidDropPath(p)) || []
          if (validPaths.length > 0) {
            logger.info('DragDrop', `dropped ${validPaths.length} file(s)`)
            appStore.showAddTaskDialog()
          }
        }
      }),
    )
  }

  function isValidDropPath(_p: string): boolean {
    return true
  }

  // ─── Single-instance listener ────────────────────────────────────
  async function setupExternalInputListeners() {
    const unlistenSingleInstance = registerCleanup(
      await listen<string[]>('single-instance-triggered', async () => {
        // Single-instance argv routing has been removed along with
        // P2P/deep-link support. Keep the listener subscribed for future use.
      }),
    )

    return { unlistenSingleInstance }
  }

  // ─── Orchestrator ─────────────────────────────────────────────────
  async function setupListeners() {
    teardown()

    await setupEngineWatchers()
    setupNavGuard()

    const { unlistenSingleInstance } = await setupExternalInputListeners()
    const unlistenDragDrop = await setupDragDropListener()
    const unlistenMenuEvent = await setupMenuListener()
    const unlistenTrayMenu = await setupTrayListener()

    // Consume any pending frontend actions queued by Rust during window
    // recreation (lightweight mode timing gap). Normal startups return
    // an empty array — this is a no-op.
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const pendingActions = await invoke<PendingFrontendAction[]>('take_pending_frontend_actions')
      if (pendingActions.length > 0) {
        logger.info('AppEvents', `consuming ${pendingActions.length} pending frontend action(s) from window recreation`)
        for (const pendingAction of pendingActions) {
          if (pendingAction.channel === 'menu-event') {
            await handleMenuAction(pendingAction.action)
          } else if (pendingAction.channel === 'tray-menu-action') {
            await handleTrayAction(pendingAction.action)
          }
        }
      }
    } catch (e) {
      logger.debug('AppEvents.pendingNativeEvents', e)
    }

    return {
      unlistenDragDrop,
      unlistenMenuEvent,
      unlistenTrayMenu,
      unlistenSingleInstance,
      teardown,
    }
  }

  return { setupListeners }
}
