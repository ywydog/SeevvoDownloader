import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAiwbCatalog, builtinRepos } from '@/composables/useAiwbCatalog'

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  localStorageMock.getItem.mockReset()
  localStorageMock.setItem.mockReset()
})

describe('useAiwbCatalog', () => {
  it('清单 = 内置 60 + 用户添加仓库', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['Me/UserRepo']))
    const { all } = useAiwbCatalog()
    expect(all.value.length).toBeGreaterThanOrEqual(60)
    expect(all.value.some((x) => x.name === 'ClassIsland')).toBe(true)
    expect(all.value.some((x) => x.repo === 'Me/UserRepo')).toBe(true)
  })

  it('addRepo 写入 localStorage 并反映在清单里', () => {
    localStorageMock.getItem.mockReturnValue(null)
    const { addRepo, all } = useAiwbCatalog()
    addRepo('Owner/RepoName')
    const calls = localStorageMock.setItem.mock.calls
    const saved = JSON.parse((calls[calls.length - 1]?.[1] as string) ?? '[]')
    expect(saved).toContain('Owner/RepoName')
    expect(all.value.some((x) => x.repo === 'Owner/RepoName')).toBe(true)
  })

  it('removeRepo 移除用户仓库', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['A/B', 'C/D']))
    const { removeRepo, all } = useAiwbCatalog()
    removeRepo('A/B')
    expect(all.value.some((x) => x.repo === 'A/B')).toBe(false)
    expect(all.value.some((x) => x.repo === 'C/D')).toBe(true)
  })

  it('忽略非 owner/name 格式的添加', () => {
    localStorageMock.getItem.mockReturnValue(null)
    const { addRepo, all } = useAiwbCatalog()
    const ok = addRepo('notAValidRepo')
    expect(ok).toBe(false)
    expect(all.value.filter((x) => !builtinRepos.has(x.repo.toLowerCase())).length).toBe(0)
  })
})
