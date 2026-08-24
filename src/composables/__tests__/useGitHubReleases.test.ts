import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitHubReleases } from '@/composables/useGitHubReleases'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

beforeEach(() => invokeMock.mockReset())

describe('useGitHubReleases', () => {
  it('返回拉取到的 releases，并带缓存命中标记', async () => {
    const payload = [
      {
        tagName: 'v1.2.0',
        name: 'v1.2.0',
        body: 'x',
        prerelease: false,
        assets: [{ name: 'a.exe', size: 1, browserDownloadUrl: 'https://g/a.exe' }],
      },
    ]
    invokeMock.mockResolvedValue(payload)
    invokeMock.mockResolvedValueOnce(payload)

    const r = useGitHubReleases()
    const first = await r.fetchReleases('o/r', { proxy: null })
    expect(first.data).toHaveLength(1)
    expect(first.cached).toBe(false)

    const second = await r.fetchReleases('o/r', { proxy: null })
    expect(second.data).toHaveLength(1)
    expect(second.cached).toBe(true)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('拉取失败时返回错误的可读信息', async () => {
    invokeMock.mockRejectedValueOnce({ Engine: 'boom' })
    const r = useGitHubReleases()
    const res = await r.fetchReleases('o/r', { proxy: null })
    expect(res.error).toBeTruthy()
    expect(res.data).toEqual([])
  })

  it('probe 返回源延迟结果或失败哨兵', async () => {
    invokeMock.mockResolvedValue(238)
    const r = useGitHubReleases()
    const ms = await r.probeSource('https://x')
    expect(ms).toBe(238)
  })
})
