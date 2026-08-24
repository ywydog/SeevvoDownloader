/** @fileoverview Utilities for download cleanup: stale record detection.
 *
 * Pure, testable functions — side effects (FS access) are injected via imports.
 */
import { join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@shared/logger'

/** Record shape needed for stale detection (not the full HistoryRecord). */
export interface StaleCheckItem {
  gid: string
  dir: string
  name: string
  /** All file paths from meta.files — if present, ALL must be gone to count as stale. */
  filePaths?: string[]
}

/** Identify records whose downloaded files no longer exist on disk.
 *  Returns the GIDs of stale records. */
export async function findStaleRecords(records: StaleCheckItem[]): Promise<string[]> {
  const staleGids: string[] = []

  for (const record of records) {
    // Multi-file: only stale if ALL expected files are gone.
    // Early-exit on first existing file for performance.
    if (record.filePaths && record.filePaths.length > 0) {
      let anyExists = false
      for (const fp of record.filePaths) {
        try {
          if (await invoke<boolean>('check_path_exists', { path: fp })) {
            anyExists = true
            break
          }
        } catch (e) {
          logger.debug('StaleCheck', `check_path_exists failed for ${fp}: ${e}`)
        }
      }
      if (!anyExists) staleGids.push(record.gid)
      continue
    }

    if (!record.dir || !record.name) {
      staleGids.push(record.gid)
      continue
    }

    try {
      const filePath = await join(record.dir, record.name)
      const fileExists = await invoke<boolean>('check_path_exists', { path: filePath })
      if (!fileExists) {
        staleGids.push(record.gid)
      }
    } catch (e) {
      logger.debug('StaleCheck', `path join/check failed for ${record.gid}: ${e}`)
      staleGids.push(record.gid)
    }
  }

  return staleGids
}
