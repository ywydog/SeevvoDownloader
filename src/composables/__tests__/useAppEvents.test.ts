import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'

const listenMock = vi.fn()
const invokeMock = vi.fn()
const routerBeforeEachMock = vi.fn()
const openUrlMock = vi.fn()
const windowApiMock = vi.hoisted(() => ({
  unminimize: vi.fn(),
  show: vi.fn(),
  setFocus: vi.fn(),
  isVisible: vi.fn(),
}))
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

let eventUnlisteners: Array<ReturnType<typeof vi.fn>> = []
let eventCallbacks: Record<string, (event: { payload: unknown }) => unknown> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApiMock,
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockImplementation(async () => vi.fn()),
  }),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    beforeEach: (...args: unknown[]) => routerBeforeEachMock(...args),
    push: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/api/aria2', () => ({
  isEngineReady: vi.fn(() => true),
}))

vi.mock('@shared/logger', () => ({
  formatLogFields: (fields: Record<string, string | number | boolean | null | undefined>) =>
    Object.entries(fields)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' '),
  logger: loggerMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useAppEvents } from '../useAppEvents'

type UseAppEventsDeps = Parameters<typeof useAppEvents>[0]

function createDeps() {
  const showEngineOverlay = ref(false)
  const isExiting = ref(false)
  const appStore = reactive({
    showAddTaskDialog: vi.fn(),
    engineReady: false,
    engineRestarting: true,
    addTaskVisible: false,
  })
  const taskStore = reactive({
    hasPausedTasks: vi.fn().mockResolvedValue(false),
    hasActiveTasks: vi.fn().mockResolvedValue(false),
    resumeAllTask: vi.fn().mockResolvedValue(undefined),
    pauseAllTask: vi.fn().mockResolvedValue(undefined),
    fetchList: vi.fn().mockResolvedValue(undefined),
  })
  const preferenceStore = reactive({
    pendingChanges: false,
    saveBeforeLeave: null as (() => Promise<void>) | null,
    updatePreference: vi.fn(),
    config: {
      lightweightMode: false,
    },
  })
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }
  const navDialog = {
    warning: vi.fn(),
  }

  const deps: UseAppEventsDeps = {
    t: (key) => key,
    appStore,
    taskStore,
    preferenceStore,
    message,
    navDialog: navDialog as never,
    showEngineOverlay,
    isExiting,
    handleExitConfirm: vi.fn().mockResolvedValue(undefined),
    onAbout: vi.fn(),
  }

  return { deps, appStore, taskStore, message }
}

function mountComposable(deps: UseAppEventsDeps) {
  let setupListeners!: ReturnType<typeof useAppEvents>['setupListeners']
  const wrapper = mount(
    defineComponent({
      setup() {
        setupListeners = useAppEvents(deps).setupListeners
        return {}
      },
      template: '<div />',
    }),
  )

  return {
    wrapper,
    setupListeners,
    unmount: () => wrapper.unmount(),
  }
}

async function fire(event: string, payload: unknown) {
  if (eventCallbacks[event]) {
    await eventCallbacks[event]({ payload })
  }
}

describe('useAppEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventUnlisteners = []
    eventCallbacks = {}

    windowApiMock.unminimize.mockResolvedValue(undefined)
    windowApiMock.show.mockResolvedValue(undefined)
    windowApiMock.setFocus.mockResolvedValue(undefined)
    windowApiMock.isVisible.mockResolvedValue(false)

    listenMock.mockImplementation(async (eventName: string, callback?: (event: { payload: unknown }) => unknown) => {
      const unlisten = vi.fn().mockName(`unlisten:${eventName}`)
      eventUnlisteners.push(unlisten)
      if (callback) {
        eventCallbacks[eventName] = callback
      }
      return unlisten
    })
    routerBeforeEachMock.mockImplementation(() => vi.fn().mockName('remove-nav-guard'))
    openUrlMock.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue([])
  })

  it('returns a teardown that unregisters engine listeners, the watcher, and the router guard', async () => {
    const { deps, appStore, message } = createDeps()
    const { setupListeners } = mountComposable(deps)

    const listeners = await setupListeners()
    expect(typeof (listeners as { teardown?: unknown }).teardown).toBe('function')

    appStore.engineRestarting = false
    await nextTick()
    expect(message.error).toHaveBeenCalledTimes(1)
    ;(listeners as { teardown: () => void }).teardown()

    appStore.engineRestarting = false
    message.error.mockClear()
    await nextTick()

    expect(message.error).not.toHaveBeenCalled()
    expect(routerBeforeEachMock).toHaveBeenCalledTimes(1)

    for (const unlisten of eventUnlisteners) {
      expect(unlisten).toHaveBeenCalledTimes(1)
    }

    const removeGuard = routerBeforeEachMock.mock.results[0]?.value as (() => void) | undefined
    expect(removeGuard).toBeDefined()
    expect(removeGuard).toHaveBeenCalledTimes(1)
  })

  it('handles menu-event actions', async () => {
    const { deps } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('menu-event', 'about')
    expect(deps.onAbout).toHaveBeenCalledTimes(1)

    await fire('menu-event', 'new-task')
    expect(deps.appStore.showAddTaskDialog).toHaveBeenCalledTimes(1)

    await fire('menu-event', 'release-notes')
    expect(openUrlMock).toHaveBeenCalledTimes(1)
  })

  it('tray-menu-action new-task reveals the window and opens the dialog', async () => {
    const { deps } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('tray-menu-action', 'new-task')
    expect(windowApiMock.unminimize).toHaveBeenCalled()
    expect(windowApiMock.show).toHaveBeenCalled()
    expect(deps.appStore.showAddTaskDialog).toHaveBeenCalledTimes(1)
  })

  it('engine-crashed sets engineReady false and shows the overlay', async () => {
    const { deps } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('engine-crashed', { code: 1 })
    expect(deps.appStore.engineReady).toBe(false)
    expect(deps.showEngineOverlay.value).toBe(true)
  })

  it('engine-stopped shows a warning toast', async () => {
    const { deps, message } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('engine-stopped', undefined)
    expect(message.warning).toHaveBeenCalled()
  })

  it('port-auto-switched toasts and patches rpc/extensionApi ports', async () => {
    const { deps, message } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('port-auto-switched', [
      { kind: 'rpc', oldPort: 29100, newPort: 29101 },
      { kind: 'extensionApi', oldPort: 29110, newPort: 29111 },
    ])

    expect(message.info).toHaveBeenCalled()
    expect(deps.preferenceStore.updatePreference).toHaveBeenCalledWith(
      expect.objectContaining({ rpcListenPort: 29101, extensionApiPort: 29111 }),
    )
  })

  it('port-auto-switch-failed shows a warning for disabled reason', async () => {
    const { deps, message } = createDeps()
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    await fire('port-auto-switch-failed', { kind: 'rpc', port: 29100, reason: 'disabled' })
    expect(message.warning).toHaveBeenCalled()
  })

  it('nav guard blocks leaving preferences when changes are pending', async () => {
    const { deps } = createDeps()
    deps.preferenceStore.pendingChanges = true
    const { setupListeners } = mountComposable(deps)
    await setupListeners()

    expect(routerBeforeEachMock).toHaveBeenCalledTimes(1)
    const guard = routerBeforeEachMock.mock.calls[0][0] as (to: unknown, from: unknown) => unknown
    const result = guard({ path: '/task/all' }, { path: '/preference/general' })
    expect(deps.navDialog.warning).toHaveBeenCalled()
    expect(result).toBeInstanceOf(Promise)
  })
})
