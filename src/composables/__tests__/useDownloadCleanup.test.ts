/** @fileoverview TDD tests for stale record detection. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckPathExists = vi.fn()

// Mock Tauri path — join uses OS-native separator, mock with /
vi.mock('@tauri-apps/api/path', () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
}))

// Mock invoke — routes filesystem-sensitive operations through Rust IPC.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'check_path_exists') return mockCheckPathExists(args)
    return Promise.reject(new Error(`Unexpected invoke: ${cmd}`))
  },
}))

const { findStaleRecords } = await import('../useDownloadCleanup')

describe('useDownloadCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findStaleRecords', () => {
    it('returns GIDs of records whose files do not exist', async () => {
      mockCheckPathExists.mockResolvedValue(false)
      const stale = await findStaleRecords([{ gid: 'g1', dir: '/d', name: 'f1.zip' }])
      expect(stale).toEqual(['g1'])
    })

    it('returns empty array when all files exist', async () => {
      mockCheckPathExists.mockResolvedValue(true)
      const stale = await findStaleRecords([{ gid: 'g1', dir: '/d', name: 'f1.zip' }])
      expect(stale).toEqual([])
    })

    it('handles empty input', async () => {
      const stale = await findStaleRecords([])
      expect(stale).toEqual([])
    })

    it('marks multi-file record as stale only when ALL files are gone', async () => {
      mockCheckPathExists.mockImplementation(({ path }: { path: string }) => Promise.resolve(path === '/d/f2.zip'))
      const stale = await findStaleRecords([{ gid: 'g1', dir: '/d', name: 'x', filePaths: ['/d/f1.zip', '/d/f2.zip'] }])
      expect(stale).toEqual([])
    })

    it('marks multi-file record as stale when ALL files are gone', async () => {
      mockCheckPathExists.mockResolvedValue(false)
      const stale = await findStaleRecords([{ gid: 'g1', dir: '/d', name: 'x', filePaths: ['/d/f1.zip', '/d/f2.zip'] }])
      expect(stale).toEqual(['g1'])
    })

    it('uses legacy single-file check when filePaths is absent', async () => {
      mockCheckPathExists.mockResolvedValue(false)
      const stale = await findStaleRecords([{ gid: 'g1', dir: '/d', name: 'f1.zip' }])
      expect(stale).toEqual(['g1'])
    })
  })
})
