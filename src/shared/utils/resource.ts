/** @fileoverview Download resource detection: HTTP/FTP protocol tags and copyright. */
import { compact } from 'lodash-es'
import { RESOURCE_TAGS, DETECT_RESOURCE_MAX_CHARS, DETECT_RESOURCE_MAX_LINES } from '@shared/constants'
import { splitTextRows } from './format'
import { isAudioOrVideo } from './file'
import { parseAria2Input } from './batchHelpers'
import type { ClipboardConfig } from '@shared/types'

export const splitTaskLinks = (links = ''): string[] => {
  return compact(splitTextRows(links))
}

/**
 * Builds the list of allowed protocol prefixes based on a ClipboardConfig filter.
 * When no filter is provided, returns all recognized protocol tags (backward compat).
 */
function buildAllowedTags(filter?: ClipboardConfig): string[] {
  if (!filter) return RESOURCE_TAGS

  const tags: string[] = []
  if (filter.http) {
    tags.push('http://', 'https://')
  }
  if (filter.ftp) {
    tags.push('ftp://')
  }
  return tags
}

function lineMatchesAllowedResource(line: string, allowedTags: string[]): boolean {
  const lower = line.toLowerCase()
  return allowedTags.some((tag) => lower.startsWith(tag) && line.length > tag.length)
}

function lineMatchesAnyResource(line: string): boolean {
  return lineMatchesAllowedResource(line, RESOURCE_TAGS)
}

function countMeaningfulInputLines(content: string): number {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length
}

/**
 * Returns true if the clipboard content represents downloadable resource(s).
 *
 * Detection rules (all must hold):
 * 1. Content length ≤ DETECT_RESOURCE_MAX_CHARS.
 * 2. Split into lines; ignore empty/whitespace-only lines.
 * 3. Every remaining line must start with a recognized protocol tag
 *    (`http://`, `https://`, `ftp://`).
 *
 * When a `filter` is provided, only the enabled protocol families are matched.
 * The `enable` master switch short-circuits to false when off.
 *
 * This rejects embedded URLs inside prose, code comments, JSON, HTML,
 * log lines, and mixed multi-line content.
 */
export const detectResource = (content: string, filter?: ClipboardConfig): boolean => {
  if (filter && !filter.enable) return false
  if (!content || content.length > DETECT_RESOURCE_MAX_CHARS) return false

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0 || lines.length > DETECT_RESOURCE_MAX_LINES) return false

  const allowedTags = buildAllowedTags(filter)

  if (lines.length === 1) return lineMatchesAllowedResource(lines[0], allowedTags)

  const parsed = parseAria2Input(content)
  if (parsed.entries.length === 0) return false

  if (parsed.validLineCount !== countMeaningfulInputLines(content)) return false

  return parsed.entries.every((entry) => entry.uris.length > 0 && entry.uris.every(lineMatchesAnyResource))
}

export const needCheckCopyright = (links = ''): boolean => {
  const uris = splitTaskLinks(links)
  const avs = uris.filter((uri) => isAudioOrVideo(uri))
  return avs.length > 0
}
