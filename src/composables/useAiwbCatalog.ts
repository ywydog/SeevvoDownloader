/** Aiwb 项目清单：内置 JSON + 用户本地添加仓库（localStorage 持久化）。 */
import { computed, ref } from 'vue'
import catalogData from '@shared/aiwb-catalog.json'

export interface AiwbEntry {
  name: string
  repo: string // owner/name
  category: '白板' | '课表' | '工具'
  desc: string
  // 用户自加项为 true
  custom?: boolean
}

export const CUSTOM_REPOS_KEY = 'seevvo-aiwb-custom-repos'

export const builtinRepos = new Set<string>()

function loadBuiltin(): AiwbEntry[] {
  const list = (catalogData as AiwbEntry[]) ?? []
  list.forEach((e) => builtinRepos.add(e.repo.toLowerCase()))
  return list
}

function loadCustomRepos(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_REPOS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function isOwnerRepo(s: string): boolean {
  const parts = s.trim().split('/')
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}

export function useAiwbCatalog() {
  const builtin = loadBuiltin()
  const customRepos = ref<string[]>(loadCustomRepos())

  const all = computed<AiwbEntry[]>(() => {
    const base: AiwbEntry[] = builtin.map((e) => ({ ...e }))
    for (const repo of customRepos.value) {
      const key = repo.toLowerCase()
      if (builtinRepos.has(key)) continue // 避免与内置重复
      base.push({ name: repo.split('/')[1], repo, category: '工具', desc: '用户自添加仓库', custom: true })
    }
    return base
  })

  function persist(repos: string[]) {
    try {
      localStorage.setItem(CUSTOM_REPOS_KEY, JSON.stringify(repos))
    } catch {
      /* ignore */
    }
  }

  function addRepo(repo: string): boolean {
    if (!isOwnerRepo(repo)) return false
    const normalized = repo.trim()
    const key = normalized.toLowerCase()
    if (builtinRepos.has(key) || customRepos.value.some((r) => r.toLowerCase() === key)) return false
    customRepos.value = [...customRepos.value, normalized]
    persist(customRepos.value)
    return true
  }

  function removeRepo(repo: string) {
    customRepos.value = customRepos.value.filter((r) => r.toLowerCase() !== repo.toLowerCase())
    persist(customRepos.value)
  }

  return { all, builtin, addRepo, removeRepo, isOwnerRepo }
}
