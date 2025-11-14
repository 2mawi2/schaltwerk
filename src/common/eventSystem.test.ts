import { describe, expect, it, vi } from 'vitest'

const listenMock = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

const warnMock = vi.fn()
vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: warnMock,
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('listenEvent', () => {
  it('catches async unlisten rejections and logs them', async () => {
    vi.resetModules()
    listenMock.mockReset()
    warnMock.mockReset()
    const unlistenError = new Error('stop failed')
    listenMock.mockResolvedValueOnce(() => Promise.reject(unlistenError))

    const { listenEvent, SchaltEvent } = await import('./eventSystem')
    const unlisten = await listenEvent(SchaltEvent.TerminalClosed, () => {})

    unlisten()

    await Promise.resolve()
    await Promise.resolve()

    const { logger } = await import('../utils/logger')
    expect(logger.warn).toHaveBeenCalledWith('[eventSystem] Failed to unlisten schaltwerk:terminal-closed', unlistenError)
  })
})
