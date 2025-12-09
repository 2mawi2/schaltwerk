import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { acquireTerminalInstance, removeTerminalInstance, addTerminalClearCallback, removeTerminalClearCallback } from './terminalRegistry'
import { terminalOutputManager } from '../stream/terminalOutputManager'

vi.mock('../stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    ensureStarted: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  },
}))

vi.mock('../gpu/gpuRendererRegistry', () => ({
  disposeGpuRenderer: vi.fn(),
}))

const addListenerMock = terminalOutputManager.addListener as unknown as ReturnType<typeof vi.fn>

describe('terminalRegistry stream flushing', () => {
  const rafHandles: number[] = []
  const originalRaf = global.requestAnimationFrame
  const originalCaf = global.cancelAnimationFrame

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(global as unknown as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = (cb: FrameRequestCallback) => {
      const handle = setTimeout(() => cb(performance.now()), 0) as unknown as number
      rafHandles.push(handle)
      return handle
    }
    ;(global as unknown as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = (handle: number) => {
      clearTimeout(handle as unknown as NodeJS.Timeout)
    }
  })

  afterEach(() => {
    ;(global as unknown as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = originalRaf
    ;(global as unknown as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = originalCaf
    rafHandles.splice(0, rafHandles.length)
    vi.useRealTimers()
  })

  it('batches and flushes pending chunks on animation frame', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('stream-test', factory)

    expect(addListenerMock).toHaveBeenCalledWith(
      'stream-test',
      expect.any(Function),
    )

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    // Simulate a rapid stream of chunks
    listener('a')
    listener('b')
    listener('c')

    // Nothing flushed until the next animation frame
    expect(rawWrite).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    // All chunks batched into single write
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('abc', expect.any(Function))

    removeTerminalInstance('stream-test')
  })

  it('clears pending chunks when clear sequence is detected', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('clear-test', factory)

    const clearCb = vi.fn()
    addTerminalClearCallback('clear-test', clearCb)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    // Simulate some output followed by a clear sequence
    listener('old content')
    listener('\x1b[3J') // Clear scrollback sequence

    await vi.runAllTimersAsync()

    // Only the clear sequence should be written (old content cleared)
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('\x1b[3J', expect.any(Function))
    expect(clearCb).toHaveBeenCalledTimes(1)

    removeTerminalClearCallback('clear-test', clearCb)
    removeTerminalInstance('clear-test')
  })
})
