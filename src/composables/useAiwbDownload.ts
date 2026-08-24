/** Aiwb 产物下载编排：加速 URL 拼接、扩展名判定，以及「exe 运行 / zip 解压安装」的执行。 */
import { invoke } from '@tauri-apps/api/core'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import { silentInstall, decompressArchive } from '@/api/installer'

const GITHUB_HOST = 'github.com'

export function buildAcceleratedUrl(url: string, prefix: string): string {
  if (!url.startsWith(`https://${GITHUB_HOST}`) && !url.startsWith(`http://${GITHUB_HOST}`)) return url
  return `${prefix}${url}`
}

export function assetExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

const EXECUTABLE_EXT = new Set(['exe', 'msi', 'bat', 'cmd'])
const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'gz'])

export function isExecutableExt(ext: string): boolean {
  return EXECUTABLE_EXT.has(ext)
}
export function isArchiveExt(ext: string): boolean {
  return ARCHIVE_EXT.has(ext)
}

export function useAiwbDownload() {
  const taskStore = useTaskStore()
  const preferenceStore = usePreferenceStore()

  function basePath(): string {
    return (preferenceStore.config.dir || '').replace(/[\\/]+$/, '')
  }

  /** 计算下载路径（下载目录 + aiwbDownloadDir） */
  function downloadDir(): string {
    const base = basePath()
    return base ? `${base}/${preferenceStore.config.aiwbDownloadDir || 'aiwb'}` : ''
  }

  function installDir(): string {
    const base = basePath()
    return base ? `${base}/${preferenceStore.config.aiwbInstallDir || 'aiwb/install'}` : ''
  }

  async function addDownload(url: string, filename: string, split: number) {
    if (!downloadDir()) throw new Error('未配置下载目录')
    return taskStore.addUri({
      uris: [url],
      outs: [filename],
      options: { dir: downloadDir(), split: String(split ?? 64) },
    })
  }

  /** 运行指定 exe/文件 */
  async function runExecutable(filePath: string) {
    return invoke('open_path_normalized', { path: filePath })
  }

  async function installArchive(archivePath: string, targetDir = installDir()) {
    const decomp = await decompressArchive(archivePath, targetDir)
    return decomp
  }

  async function silentExecutable(filePath: string) {
    return silentInstall(filePath)
  }

  return { downloadDir, installDir, addDownload, runExecutable, installArchive, silentExecutable }
}
