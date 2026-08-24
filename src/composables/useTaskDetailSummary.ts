/** @fileoverview Type-aware task detail summaries for the drawer UI. */
import type { Aria2Task, Aria2File } from '@shared/types'

export type TaskDetailKind = 'uri'

export interface UriDetailSummary {
  primaryUri: string
  fileCount: number
  selectedFileCount: number
  mirrorCount: number
  usedMirrorCount: number
  waitingMirrorCount: number
}

export interface TaskTransferSummary {
  showUploadMetrics: boolean
  showSeeders: boolean
  ratio: number
}

export function getTaskDetailStatusLabelKey(status: string | undefined): string {
  return status === 'seeding' || status === 'sharing' || status === 'bt-metadata-fetching'
    ? `task.${status}`
    : `task.status-${status}`
}

export function buildTaskDetailKind(_task: Aria2Task | null | undefined): TaskDetailKind {
  return 'uri'
}

function toPositiveInt(value: string | number | boolean | undefined): number {
  if (typeof value === 'boolean') return Number(value)
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function selectedFiles(files: Aria2File[]): Aria2File[] {
  return files.filter((file) => file.selected === 'true')
}

export function buildUriDetailSummary(task: Aria2Task | null | undefined): UriDetailSummary {
  const files = task?.files ?? []
  const uris = files.flatMap((file) => file.uris ?? [])
  return {
    primaryUri: uris[0]?.uri ?? '',
    fileCount: files.length,
    selectedFileCount: selectedFiles(files).length,
    mirrorCount: uris.length,
    usedMirrorCount: uris.filter((uri) => uri.status === 'used').length,
    waitingMirrorCount: uris.filter((uri) => uri.status === 'waiting').length,
  }
}

export function buildTaskTransferSummary(task: Aria2Task | null | undefined): TaskTransferSummary {
  return {
    showUploadMetrics: true,
    showSeeders: false,
    ratio: task ? toRatio(task.totalLength, task.uploadLength) : 0,
  }
}

function toRatio(totalLength: string | number | undefined, uploadLength: string | number | undefined): number {
  const total = toPositiveInt(totalLength)
  const upload = toPositiveInt(uploadLength)
  if (total === 0 || upload === 0) return 0
  return Number((upload / total).toFixed(4))
}
