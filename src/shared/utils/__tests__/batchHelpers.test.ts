import { beforeEach, describe, expect, it } from 'vitest'
import {
  createBatchItem,
  detectKind,
  mergeUriLines,
  mergeRawUriLines,
  normalizeUriLines,
  resetBatchIdCounter,
  decodePathSegment,
  extractDecodedFilename,
  sanitizeAria2OutHint,
  resolveExternalFilenameHint,
  parseAria2Input,
} from '../batchHelpers'

describe('normalizeUriLines', () => {
  it('splits lines, trims whitespace, drops blanks, and preserves first occurrence order', () => {
    expect(
      normalizeUriLines(`
        https://a.example/file

        https://a.example/file
        ftp://b.example/file
      `),
    ).toEqual(['https://a.example/file', 'ftp://b.example/file'])
  })

  it('preserves magnet/thunder URIs as-is (no hash wrapping for P2P)', () => {
    expect(normalizeUriLines('https://a.example/file\nmagnet:?xt=urn:btih:abc\nthunder://foo')).toEqual([
      'https://a.example/file',
      'magnet:?xt=urn:btih:abc',
      'thunder://foo',
    ])
  })

  it('handles multiline payload text exactly like a textarea source', () => {
    expect(normalizeUriLines('https://a.example/file\nhttps://b.example/file\nhttps://a.example/file\n')).toEqual([
      'https://a.example/file',
      'https://b.example/file',
    ])
  })
})

describe('detectKind', () => {
  it('always returns uri for HTTP/FTP and P2P sources (P2P removed)', () => {
    expect(detectKind('https://example.com/file.zip')).toBe('uri')
    expect(detectKind('ftp://example.com/file.bin')).toBe('uri')
    expect(detectKind('magnet:?xt=urn:btih:abc')).toBe('uri')
  })
})

describe('createBatchItem', () => {
  beforeEach(() => resetBatchIdCounter())

  it('creates a batch item with incremental ids and display name', () => {
    const a = createBatchItem('uri', 'https://example.com/file.zip')
    const b = createBatchItem('uri', 'ftp://example.com/file.bin')
    expect(a.id).toBe('batch-1')
    expect(b.id).toBe('batch-2')
    expect(a.kind).toBe('uri')
    expect(a.displayName).toBe('https://example.com/file.zip')
    expect(a.status).toBe('pending')
  })

  it('truncates long URIs for display', () => {
    const long = 'https://example.com/' + 'x'.repeat(100)
    const item = createBatchItem('uri', long)
    expect(item.displayName.length).toBeLessThanOrEqual(80)
  })
})

describe('mergeUriLines / mergeRawUriLines', () => {
  it('merges incoming lines with dedup', () => {
    const merged = mergeUriLines('https://a.example/file', ['https://a.example/file', 'https://b.example/file'])
    expect(merged).toBe('https://a.example/file\nhttps://b.example/file')
  })

  it('mergeRawUriLines preserves raw protocol wrappers', () => {
    const merged = mergeRawUriLines('', ['https://a.example/file\nmagnet:?xt=urn:btih:abc'])
    expect(merged).toBe('https://a.example/file\nmagnet:?xt=urn:btih:abc')
  })
})

describe('parseAria2Input', () => {
  it('parses multi-line input into URI entries', () => {
    const result = parseAria2Input('https://a.example/file\nhttps://b.example/file')
    expect(result.validLineCount).toBe(2)
    expect(result.entries).toHaveLength(2)
  })

  it('treats indented option lines as per-task options', () => {
    const result = parseAria2Input('https://a.example/file\n  referer=https://a.example/')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].options.referer).toBe('https://a.example/')
    expect(result.validLineCount).toBe(2)
  })
})

describe('extractDecodedFilename', () => {
  it('extracts and decodes a filename from a URI path', () => {
    expect(extractDecodedFilename('https://example.com/a%20b.zip')).toBe('a b.zip')
  })

  it('returns empty for data/blob URIs and magnet links', () => {
    expect(extractDecodedFilename('data:text/plain;base64,AA==')).toBe('')
    expect(extractDecodedFilename('magnet:?xt=urn:btih:abc')).toBe('')
  })
})

describe('decodePathSegment', () => {
  it('decodes percent-encoded segments', () => {
    expect(decodePathSegment('a%20b')).toBe('a b')
  })
  it('returns input unchanged on malformed encoding', () => {
    expect(decodePathSegment('a%zzb')).toBe('a%zzb')
  })
})

describe('sanitizeAria2OutHint', () => {
  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeAria2OutHint('a/b:c*d.zip')).toBe('b_c_d.zip')
  })
  it('returns empty for empty input', () => {
    expect(sanitizeAria2OutHint('')).toBe('')
  })
})

describe('resolveExternalFilenameHint', () => {
  it('accepts a hint with extension', () => {
    expect(resolveExternalFilenameHint('https://cdn.example.com/hash', 'report.pdf')).toBe('report.pdf')
  })
  it('rejects weak placeholders', () => {
    expect(resolveExternalFilenameHint('https://cdn.example.com/report.pdf', 'download')).toBe('')
  })
})
