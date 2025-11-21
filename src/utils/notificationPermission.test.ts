import { describe, it, expect, vi, beforeEach } from 'vitest'

const debugMock = vi.fn()

vi.mock('./logger', () => ({
  logger: {
    debug: debugMock,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
}))

describe('notificationPermission', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns false and logs once when permission check rejects', async () => {
    const notificationModule = await import('@tauri-apps/plugin-notification')
    vi.mocked(notificationModule.isPermissionGranted).mockRejectedValue(new Error('rejected'))

    const { isNotificationPermissionGranted, resetNotificationPermissionDebugFlag } =
      await import('./notificationPermission')

    resetNotificationPermissionDebugFlag()

    const firstResult = await isNotificationPermissionGranted()
    const secondResult = await isNotificationPermissionGranted()

    expect(firstResult).toBe(false)
    expect(secondResult).toBe(false)
    expect(debugMock).toHaveBeenCalledTimes(1)
    expect(debugMock.mock.calls[0]?.[0]).toContain('[notificationPermission]')
  })
})
