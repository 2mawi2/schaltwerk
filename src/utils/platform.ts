import { platform } from '@tauri-apps/plugin-os'

type SupportedPlatform = 'macos' | 'linux' | 'windows'

let cachedPlatform: SupportedPlatform | null = null

export async function getPlatform(): Promise<SupportedPlatform> {
  if (cachedPlatform === null) {
    cachedPlatform = await platform()
  }
  return cachedPlatform
}

export async function isMacOS(): Promise<boolean> {
  const p = await getPlatform()
  return p === 'macos'
}

export async function isLinux(): Promise<boolean> {
  const p = await getPlatform()
  return p === 'linux'
}

export async function isWindows(): Promise<boolean> {
  const p = await getPlatform()
  return p === 'windows'
}

// Export a function to clear cache for testing
export function _clearPlatformCache(): void {
  cachedPlatform = null
}
