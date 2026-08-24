/** @fileoverview Tests for resource detection utilities (HTTP/FTP only). */
import { describe, it, expect } from 'vitest'
import { splitTaskLinks, detectResource, needCheckCopyright } from '../resource'
import { DETECT_RESOURCE_MAX_CHARS, DETECT_RESOURCE_MAX_LINES } from '@shared/constants'
import type { ClipboardConfig } from '@shared/types'

describe('splitTaskLinks', () => {
  it('splits multiline links', () => {
    const result = splitTaskLinks('http://a.com\nhttp://b.com')
    expect(result).toEqual(['http://a.com', 'http://b.com'])
  })
  it('returns empty for empty input', () => {
    expect(splitTaskLinks('')).toEqual([])
  })
})

describe('detectResource', () => {
  it('detects http/https/ftp URLs', () => {
    expect(detectResource('http://example.com/file.zip')).toBe(true)
    expect(detectResource('https://cdn.example.com/release-v2.tar.gz')).toBe(true)
    expect(detectResource('ftp://mirror.example.com/pub/file.iso')).toBe(true)
  })
  it('is case insensitive on scheme and ignores surrounding whitespace', () => {
    expect(detectResource('  https://example.com/file.zip  ')).toBe(true)
    expect(detectResource('HTTP://EXAMPLE.COM/file.zip')).toBe(true)
    expect(detectResource('FTP://mirror.example.com/pub/file.iso')).toBe(true)
  })
  it('detects multiple URL lines', () => {
    const input = 'http://a.com/1.zip\nhttps://b.com/2.zip'
    expect(detectResource(input)).toBe(true)
  })
  it('rejects prose and mixed content', () => {
    expect(detectResource('Visit http://example.com for more info')).toBe(false)
    expect(detectResource('Here is a file:\nhttp://example.com/file.zip')).toBe(false)
    expect(detectResource('hello world')).toBe(false)
  })
  it('rejects bare/incomplete URLs', () => {
    expect(detectResource('https://')).toBe(false)
    expect(detectResource('http://')).toBe(false)
    expect(detectResource('ftp://')).toBe(false)
    expect(detectResource('myapp://open?id=123')).toBe(false)
  })
  it('handles empty and oversized content', () => {
    expect(detectResource('')).toBe(false)
    expect(detectResource('   \n\n   ')).toBe(false)
    expect(detectResource('x'.repeat(DETECT_RESOURCE_MAX_CHARS + 1))).toBe(false)
  })
  it('rejects too many lines', () => {
    const urls = Array.from({ length: DETECT_RESOURCE_MAX_LINES + 1 }, (_, i) => `https://example.com/${i}.zip`)
    expect(detectResource(urls.join('\n'))).toBe(false)
  })
})

describe('detectResource with ClipboardConfig filter', () => {
  const httpOnly: ClipboardConfig = { enable: true, http: true, ftp: false }
  const ftpOnly: ClipboardConfig = { enable: true, http: false, ftp: true }
  const none: ClipboardConfig = { enable: true, http: false, ftp: false }

  it('respects http filter', () => {
    expect(detectResource('https://example.com/file.zip', httpOnly)).toBe(true)
    expect(detectResource('ftp://mirror.example.com/pub/file.iso', httpOnly)).toBe(false)
  })
  it('respects ftp filter', () => {
    expect(detectResource('ftp://mirror.example.com/pub/file.iso', ftpOnly)).toBe(true)
    expect(detectResource('https://example.com/file.zip', ftpOnly)).toBe(false)
  })
  it('rejects when neither http nor ftp is enabled', () => {
    expect(detectResource('https://example.com/file.zip', none)).toBe(false)
    expect(detectResource('ftp://mirror.com/file.iso', none)).toBe(false)
  })
  it('short-circuits when master switch is disabled', () => {
    const disabled: ClipboardConfig = { enable: false, http: true, ftp: true }
    expect(detectResource('https://example.com/file.zip', disabled)).toBe(false)
  })
})

describe('needCheckCopyright', () => {
  it('detects audio/video links', () => {
    expect(needCheckCopyright('http://example.com/video.mp4')).toBe(true)
  })
  it('returns false for non-media links', () => {
    expect(needCheckCopyright('http://example.com/file.zip')).toBe(false)
  })
})
