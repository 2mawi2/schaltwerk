import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPlatform, isMacOS, isLinux, isWindows, _clearPlatformCache } from '../platform'

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}))

import { platform } from '@tauri-apps/plugin-os'

describe('platform utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the cached platform
    _clearPlatformCache()
  })

  it('identifies macOS correctly', async () => {
    vi.mocked(platform).mockResolvedValue('macos')

    expect(await isMacOS()).toBe(true)
    expect(await isLinux()).toBe(false)
    expect(await isWindows()).toBe(false)
  })

  it('identifies Linux correctly', async () => {
    vi.mocked(platform).mockResolvedValue('linux')

    expect(await isLinux()).toBe(true)
    expect(await isMacOS()).toBe(false)
    expect(await isWindows()).toBe(false)
  })

  it('identifies Windows correctly', async () => {
    vi.mocked(platform).mockResolvedValue('windows')

    expect(await isWindows()).toBe(true)
    expect(await isMacOS()).toBe(false)
    expect(await isLinux()).toBe(false)
  })

  it('caches platform detection', async () => {
    vi.mocked(platform).mockResolvedValue('macos')

    await getPlatform()
    await getPlatform()
    await getPlatform()

    // Should only call once due to caching
    expect(platform).toHaveBeenCalledTimes(1)
  })
})
