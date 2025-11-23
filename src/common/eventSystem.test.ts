import { describe, expect, it, vi } from 'vitest'

const listenMock = vi.fn()
const warnMock = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}))

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: warnMock,
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('listenEvent', () => {
  beforeEach(() => {
    vi.resetModules()
    listenMock.mockReset()
    warnMock.mockReset()
  })

  it('catches async unlisten rejections and logs them', async () => {
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

  it('is idempotent when unlisten is called multiple times', async () => {
    const underlyingUnlisten = vi.fn()
    listenMock.mockResolvedValueOnce(underlyingUnlisten)

    const { listenEvent, SchaltEvent } = await import('./eventSystem')
    const unlisten = await listenEvent(SchaltEvent.TerminalClosed, () => {})

    unlisten()
    unlisten()

    expect(underlyingUnlisten).toHaveBeenCalledTimes(1)
    expect(warnMock).not.toHaveBeenCalled()
  })
})
