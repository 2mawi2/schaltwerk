export async function platform(): Promise<'macos' | 'linux' | 'windows'> {
  // Default to macOS in tests; individual tests can override via vi.mock
  return 'macos'
}
