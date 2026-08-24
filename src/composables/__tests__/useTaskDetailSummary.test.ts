import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@shared/types'
import {
  buildTaskDetailKind,
  buildTaskTransferSummary,
  buildUriDetailSummary,
  getTaskDetailStatusLabelKey,
} from '../useTaskDetailSummary'

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '1000',
    completedLength: '400',
    uploadLength: '0',
    downloadSpeed: '100',
    uploadSpeed: '0',
    connections: '2',
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/file.zip',
        length: '1000',
        completedLength: '400',
        selected: 'true',
        uris: [{ uri: 'https://example.com/file.zip', status: 'used' }],
      },
    ],
    ...overrides,
  }
}

describe('buildTaskDetailKind', () => {
  it('always classifies HTTP/FTP tasks as uri (P2P removed)', () => {
    expect(buildTaskDetailKind(makeTask())).toBe('uri')
    expect(buildTaskDetailKind(null)).toBe('uri')
  })
})

describe('getTaskDetailStatusLabelKey', () => {
  it.each([
    ['active', 'task.status-active'],
    ['waiting', 'task.status-waiting'],
    ['paused', 'task.status-paused'],
    ['complete', 'task.status-complete'],
    ['error', 'task.status-error'],
    ['removed', 'task.status-removed'],
    ['seeding', 'task.seeding'],
    ['sharing', 'task.sharing'],
  ])('maps %s to %s', (status, expected) => {
    expect(getTaskDetailStatusLabelKey(status)).toBe(expected)
  })
})

describe('buildUriDetailSummary', () => {
  it('summarizes sources and mirrors', () => {
    const summary = buildUriDetailSummary(
      makeTask({
        files: [
          {
            index: '1',
            path: '/downloads/file.zip',
            length: '1000',
            completedLength: '400',
            selected: 'true',
            uris: [
              { uri: 'https://mirror-a.example/file.zip', status: 'used' },
              { uri: 'https://mirror-b.example/file.zip', status: 'waiting' },
            ],
          },
        ],
      }),
    )

    expect(summary.primaryUri).toBe('https://mirror-a.example/file.zip')
    expect(summary.mirrorCount).toBe(2)
    expect(summary.fileCount).toBe(1)
    expect(summary.selectedFileCount).toBe(1)
  })
})

describe('buildTaskTransferSummary', () => {
  it('reports upload metrics for HTTP/FTP tasks', () => {
    const uri = buildTaskTransferSummary(makeTask({ totalLength: '1000', uploadLength: '900' }))

    expect(uri.showUploadMetrics).toBe(true)
    expect(uri.showSeeders).toBe(false)
    expect(uri.ratio).toBe(0.9)
  })
})
