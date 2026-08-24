import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@shared/types'
import { buildSourceDetailRows, sourceRowsSignature } from '../useTaskDetailRows'

function makeTask(uri: string): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '100',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/file.bin',
        length: '100',
        completedLength: '0',
        selected: 'true',
        uris: [
          { uri, status: 'used' },
          { uri: `${uri}?mirror=2`, status: 'waiting' },
        ],
      },
    ],
  }
}

describe('buildSourceDetailRows', () => {
  it('uses short stable keys instead of full URLs', () => {
    const longUrl = `https://example.com/${'segment-'.repeat(80)}file.bin`
    const rows = buildSourceDetailRows(makeTask(longUrl))

    expect(rows.map((row) => row.key)).toEqual(['1-0', '1-1'])
    expect(rows[0].uri).toBe(longUrl)
  })

  it('signs source rows by shape so URL churn does not rebuild the table', () => {
    expect(sourceRowsSignature(makeTask('https://a.example/file.bin'))).toBe(
      sourceRowsSignature(makeTask('https://b.example/file.bin')),
    )
  })
})
