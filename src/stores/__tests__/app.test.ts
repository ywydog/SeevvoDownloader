/**
 * @fileoverview Unit tests for the AppStore (stat, add-task dialog, engine flags).
 * External-input / deep-link / batch store APIs were removed with P2P support.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../app'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

describe('app store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('showAddTaskDialog opens the dialog', () => {
    const store = useAppStore()
    expect(store.addTaskVisible).toBe(false)
    store.showAddTaskDialog()
    expect(store.addTaskVisible).toBe(true)
  })

  it('hideAddTaskDialog closes the dialog', () => {
    const store = useAppStore()
    store.showAddTaskDialog()
    store.hideAddTaskDialog()
    expect(store.addTaskVisible).toBe(false)
  })

  it('handleStatEvent updates reactive stats and interval', () => {
    const store = useAppStore()
    store.handleStatEvent({
      downloadSpeed: 5000,
      uploadSpeed: 1000,
      numActive: 2,
      numWaiting: 3,
      numStopped: 4,
      numStoppedTotal: 10,
    })
    expect(store.stat.numActive).toBe(2)
    expect(store.stat.downloadSpeed).toBe(5000)
    expect(store.stat.numWaiting).toBe(3)
  })

  it('handleStatEvent zeroes download speed when no active tasks', () => {
    const store = useAppStore()
    store.handleStatEvent({
      downloadSpeed: 5000,
      uploadSpeed: 1000,
      numActive: 0,
      numWaiting: 3,
      numStopped: 4,
      numStoppedTotal: 10,
    })
    expect(store.stat.downloadSpeed).toBe(0)
    expect(store.stat.uploadSpeed).toBe(1000)
  })

  it('setEngineRestarting(true) keeps the flag set', () => {
    const store = useAppStore()
    store.setEngineRestarting(true)
    expect(store.engineRestarting).toBe(true)
  })

  it('updateAddTaskOptions stores engine options', () => {
    const store = useAppStore()
    store.updateAddTaskOptions({ split: '32' })
    expect(store.addTaskOptions).toMatchObject({ split: '32' })
  })

  it('fetchEngineInfo updates engine info', async () => {
    const store = useAppStore()
    await store.fetchEngineInfo({ getVersion: () => Promise.resolve({ version: '1.0', enabledFeatures: ['http'] }) })
    expect(store.engineInfo.version).toBe('1.0')
    expect(store.engineInfo.enabledFeatures).toContain('http')
  })

  it('fetchEngineOptions updates engine options', async () => {
    const store = useAppStore()
    const data = await store.fetchEngineOptions({
      getGlobalOption: () => Promise.resolve({ 'max-concurrent-downloads': '6' }),
    })
    expect(data['max-concurrent-downloads']).toBe('6')
  })
})
