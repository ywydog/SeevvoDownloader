/** @fileoverview File selection, filtering, extension parsing, and torrent detection. */
import type { Aria2File, EnrichedFile } from '@shared/types'
import {
  NONE_SELECTED_FILES,
  SELECTED_ALL_FILES,
  IMAGE_SUFFIXES,
  AUDIO_SUFFIXES,
  VIDEO_SUFFIXES,
  SUB_SUFFIXES,
  DOCUMENT_SUFFIXES,
} from '@shared/constants'

/** Returns the selected file indices as a comma-separated string for aria2 select-file option. */
export const getFileSelection = (files: Aria2File[] = []): string => {
  const selectedFiles = files.filter((file) => file.selected === 'true')
  if (files.length === 0 || selectedFiles.length === 0) return NONE_SELECTED_FILES
  if (files.length === selectedFiles.length) return SELECTED_ALL_FILES
  const indexArr: number[] = []
  files.forEach((file, index) => {
    if (file.selected === 'true') {
      indexArr.push(index + 1) // aria2 uses 1-based file indices
    }
  })
  return indexArr.join(',')
}

export const getFileName = (fullPath: string): string => {
  return fullPath.replace(/^.*[/\\]/, '')
}

export const getFileExtension = (filename: string): string => {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2)
}

export const removeExtensionDot = (extension = ''): string => {
  return extension.replace('.', '')
}

export const filterVideoFiles = (files: EnrichedFile[] = []): EnrichedFile[] => {
  const suffix = [...VIDEO_SUFFIXES, ...SUB_SUFFIXES]
  return files.filter((item) => item.extension && suffix.includes(item.extension))
}

export const filterAudioFiles = (files: EnrichedFile[] = []): EnrichedFile[] => {
  return files.filter((item) => item.extension && AUDIO_SUFFIXES.includes(item.extension))
}

export const filterImageFiles = (files: EnrichedFile[] = []): EnrichedFile[] => {
  return files.filter((item) => item.extension && IMAGE_SUFFIXES.includes(item.extension))
}

export const filterDocumentFiles = (files: EnrichedFile[] = []): EnrichedFile[] => {
  return files.filter((item) => item.extension && DOCUMENT_SUFFIXES.includes(item.extension))
}

export const isAudioOrVideo = (uri = ''): boolean => {
  const suffixs = [...AUDIO_SUFFIXES, ...VIDEO_SUFFIXES]
  return suffixs.some((suffix) => uri.includes(suffix))
}
