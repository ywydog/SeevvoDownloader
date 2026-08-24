/**
 * @fileoverview 下载源管理：GitHub 加速源前缀拼接（源自原 SeevvoDownloader 的 DOWNLOAD_SOURCES 逻辑）。
 * 软件清单中标记为 github_path 的条目会加上当前下载源前缀；直链 url 不受影响。
 */
import { ref } from 'vue'
import type { SoftwareCatalogItem } from './useSoftwareCatalog'

export interface DownloadSourceDefinition {
  key: string
  name: string
  prefix: string
}

/** 下载源列表（与原 SeevvoDownloader DOWNLOAD_SOURCES 一致） */
export const DOWNLOAD_SOURCES: DownloadSourceDefinition[] = [
  { key: 'hk', name: '香港加速站', prefix: 'https://hk.gh-proxy.org/https://github.com' },
  { key: 'cloudflare', name: 'CloudFlare加速站', prefix: 'https://gh-proxy.org/https://github.com' },
  { key: 'edgeone', name: 'EdgeOne加速站', prefix: 'https://edgeone.gh-proxy.org/https://github.com' },
  { key: 'geekertao', name: 'Geekertao加速站', prefix: 'https://ghfile.geekertao.top/https://github.com' },
]

export const DEFAULT_SOURCE_KEY = 'hk'

const STORE_KEY = 'seevvo-download-source'

/** 当前选中的下载源 */
const currentSourceKey = ref<string>(loadSavedSource())

function loadSavedSource(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved && DOWNLOAD_SOURCES.some((s) => s.key === saved)) return saved
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCE_KEY
}

function persistSource(key: string): void {
  try {
    localStorage.setItem(STORE_KEY, key)
  } catch {
    /* ignore */
  }
}

/** 当前下载源 key（响应式） */
export function useDownloadSource() {
  const currentSource = () => currentSourceKey.value

  function setSource(key: string): boolean {
    if (!DOWNLOAD_SOURCES.some((s) => s.key === key)) return false
    currentSourceKey.value = key
    persistSource(key)
    return true
  }

  function getCurrentSourceName(): string {
    return DOWNLOAD_SOURCES.find((s) => s.key === currentSourceKey.value)?.name ?? '未知'
  }

  /** 计算软件最终下载地址 */
  function resolveDownloadUrl(item: SoftwareCatalogItem): string {
    if (item.github_path) {
      const prefix = DOWNLOAD_SOURCES.find((s) => s.key === currentSourceKey.value)?.prefix
      if (prefix) return `${prefix}${item.github_path}`
    }
    return item.url ?? ''
  }

  return { currentSource, setSource, getCurrentSourceName, resolveDownloadUrl }
}
