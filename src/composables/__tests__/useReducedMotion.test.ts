import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia } from 'pinia'
import { createApp, defineComponent, nextTick } from 'vue'
import { usePreferenceStore } from '@/stores/preference'
import { REDUCED_MOTION_CLASS, useReducedMotionClass } from '@/composables/useReducedMotion'

describe('useReducedMotionClass', () => {
  let unmount: (() => void) | undefined

  beforeEach(() => {
    document.documentElement.classList.remove(REDUCED_MOTION_CLASS)
  })

  afterEach(() => {
    unmount?.()
    unmount = undefined
    document.documentElement.classList.remove(REDUCED_MOTION_CLASS)
  })

  function mountPreference(reduceMotion: boolean) {
    const pinia = createPinia()
    const component = defineComponent({
      setup() {
        useReducedMotionClass()
        return () => null
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = createApp(component)
    app.use(pinia)
    const store = usePreferenceStore(pinia)
    store.config.reduceMotion = reduceMotion
    app.mount(container)
    unmount = () => {
      app.unmount()
      container.remove()
    }
    return store
  }

  it('keeps animations enabled by default', () => {
    mountPreference(false)
    expect(document.documentElement.classList.contains(REDUCED_MOTION_CLASS)).toBe(false)
  })

  it('updates the document class when the preference changes', async () => {
    const store = mountPreference(true)
    expect(document.documentElement.classList.contains(REDUCED_MOTION_CLASS)).toBe(true)

    store.config.reduceMotion = false
    await nextTick()
    expect(document.documentElement.classList.contains(REDUCED_MOTION_CLASS)).toBe(false)
  })
})
