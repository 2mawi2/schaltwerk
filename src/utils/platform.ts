import { platform } from '@tauri-apps/plugin-os'

type SupportedPlatform = 'macos' | 'linux' | 'windows'

let cachedPlatform: SupportedPlatform | null = null

function mapPlatform(rawPlatform: string): SupportedPlatform {
  switch (rawPlatform) {
    case 'darwin':
      return 'macos'
    case 'windows':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'linux'
  }
}

export async function getPlatform(): Promise<SupportedPlatform> {
  if (cachedPlatform === null) {
    const result = await platform()
    cachedPlatform = mapPlatform(result)
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
