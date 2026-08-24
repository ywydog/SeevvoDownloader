import { describe, it, expect } from 'vitest'
import { buildAcceleratedUrl, assetExtension, isExecutableExt, isArchiveExt } from '@/composables/useAiwbDownload'

describe('useAiwbDownload 纯函数', () => {
  const PREFIX = 'https://hk.gh-proxy.org/https://github.com'
  const DOWNLOAD_URL = 'https://github.com/o/r/releases/download/v1/app.exe'

  it('buildAcceleratedUrl 用下载源前缀包裹 GitHub 资产地址', () => {
    expect(buildAcceleratedUrl(DOWNLOAD_URL, PREFIX)).toBe(`${PREFIX}${DOWNLOAD_URL}`)
  })

  it('buildAcceleratedUrl 对非 github 直链原样返回', () => {
    expect(buildAcceleratedUrl('https://other.com/a.zip', PREFIX)).toBe('https://other.com/a.zip')
  })

  it('assetExtension 取小写扩展名', () => {
    expect(assetExtension('App.Exe')).toBe('exe')
    expect(assetExtension('noext')).toBe('')
  })

  it('isExecutableExt / isArchiveExt 判定', () => {
    expect(isExecutableExt('exe')).toBe(true)
    expect(isExecutableExt('msi')).toBe(true)
    expect(isExecutableExt('zip')).toBe(false)
    expect(isArchiveExt('zip')).toBe(true)
    expect(isArchiveExt('7z')).toBe(true)
  })
})
