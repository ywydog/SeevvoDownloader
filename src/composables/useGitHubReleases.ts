/** GitHub Releases 拉取与下载源测速封装（带 TTL 内存缓存，避免触发限流）。 */
import { invoke } from '@tauri-apps/api/core'

export interface GitHubAsset {
  name: string
  size: number
  browserDownloadUrl: string
}

export interface GitHubRelease {
  tagName: string
  name: string
  body: string
  prerelease: boolean
  assets: GitHubAsset[]
}

export interface ProbeOptions {
  proxy: string | null
}

interface CacheEntry {
  data: GitHubRelease[]
  expiresAt: number
}

const PREROLL_TTL_MS = 10 * 60 * 1000 // 10 分钟

/** 缓存键 = owner/repo */
function cacheKey(repo: string): string {
  return repo.toLowerCase()
}

export function useGitHubReleases() {
  const releaseCache = new Map<string, CacheEntry>()
  async function fetchReleases(
    repo: string,
    opts: ProbeOptions,
  ): Promise<{ data: GitHubRelease[]; error: string | null; cached: boolean }> {
    const key = cacheKey(repo)
    const hit = releaseCache.get(key)
    if (hit && hit.expiresAt > Date.now()) {
      return { data: hit.data, error: null, cached: true }
    }

    try {
      const data = await invoke<GitHubRelease[]>('fetch_github_releases', { repo, proxy: opts.proxy })
      releaseCache.set(key, { data, expiresAt: Date.now() + PREROLL_TTL_MS })
      return { data, error: null, cached: false }
    } catch (e) {
      const msg = typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e ?? '未知错误')
      return { data: [], error: msg, cached: false }
    }
  }

  async function probeSource(url: string, opts: ProbeOptions = { proxy: null }): Promise<number | null> {
    try {
      return await invoke<number>('probe_http_head', { url, proxy: opts.proxy })
    } catch {
      return null
    }
  }

  return { fetchReleases, probeSource }
}
