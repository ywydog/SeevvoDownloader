/** @fileoverview Pure row builders for heavy task detail tabs. */
import { calcProgress, getFileExtension, getFileName } from '@shared/utils'
import { decodePathSegment } from '@shared/utils/batchHelpers'
import type { Aria2File, Aria2Task } from '@shared/types'

export interface FileDetailRow {
  idx: number
  name: string
  extension: string
  length: number
  completedLength: number
  percent: number
  selected: boolean
}

export interface SourceDetailRow {
  key: string
  fileIndex: number
  uriIndex: number
  uri: string
  status: string
}

export function buildFileDetailRows(files: Aria2File[]): FileDetailRow[] {
  return files.map((item) => {
    const name = decodePathSegment(getFileName(item.path))
    const length = Number(item.length)
    const completedLength = Number(item.completedLength)
    return {
      idx: Number(item.index),
      name,
      extension: '.' + getFileExtension(name),
      length,
      completedLength,
      percent: calcProgress(item.length, item.completedLength, 1),
      selected: item.selected === 'true',
    }
  })
}

export function buildSourceDetailRows(task: Aria2Task | null | undefined): SourceDetailRow[] {
  return (task?.files ?? []).flatMap((file) =>
    (file.uris ?? []).map((uri, uriIndex) => ({
      key: `${file.index}-${uriIndex}`,
      fileIndex: Number(file.index),
      uriIndex,
      uri: uri.uri,
      status: uri.status || '-',
    })),
  )
}

export function sourceRowsSignature(task: Aria2Task | null | undefined): string {
  const files = task?.files ?? []
  const shape = files
    .map(
      (file) =>
        `${file.index}:${file.uris?.length ?? 0}:${(file.uris ?? []).map((uri) => uri.status || '-').join(',')}`,
    )
    .join(';')
  return `${task?.gid ?? ''}:${files.length}:${shape}`
}
