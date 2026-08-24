/**
 * @fileoverview 希沃软件安装 API：封装 Rust 侧静默安装/解压/进程命令。
 */
import { invoke } from '@tauri-apps/api/core'

export interface InstallResult {
  success: boolean
  message: string
}

/** 静默安装安装包（需管理员权限，前端先 UAC 提权） */
export async function silentInstall(installerPath: string): Promise<InstallResult> {
  return invoke<InstallResult>('silent_install_software', { installerPath })
}

/** 解压压缩包到指定目录（支持 zip/7z） */
export async function decompressArchive(archivePath: string, outputDir: string): Promise<InstallResult> {
  return invoke<InstallResult>('decompress_archive', { archivePath, outputDir })
}

/** 终止指定进程 */
export async function killProcessByName(processName: string): Promise<InstallResult> {
  return invoke<InstallResult>('kill_process_by_name', { processName })
}
