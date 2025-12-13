import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireTerminalInstance,
  removeTerminalInstance,
  addTerminalClearCallback,
  removeTerminalClearCallback,
  addTerminalOutputCallback,
  removeTerminalOutputCallback,
} from './terminalRegistry'
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
        shouldFollowOutput: () => true,
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
        shouldFollowOutput: () => true,
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
    expect(clearCb).not.toHaveBeenCalled()

    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()
    expect(clearCb).toHaveBeenCalledTimes(1)

    removeTerminalClearCallback('clear-test', clearCb)
    removeTerminalInstance('clear-test')
  })

  it('does not force scrollToBottom in alternate buffer', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'alternate',
            },
          },
        },
        shouldFollowOutput: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('alternate-buffer-test', factory)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('alternate-buffer-test')
  })

  it('does not force scrollToBottom when cursor is moved near bottom in normal buffer', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          rows: 10,
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
              cursorY: 8,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('cursor-move-test', factory)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('frame update')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('cursor-move-test')
  })

  it('does not follow output when shouldFollowOutput returns false', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-follow-test', factory)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('tui-follow-test')
  })

  it('fires output callbacks after write flush completes', async () => {
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
        shouldFollowOutput: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('output-test', factory)

    const outCb = vi.fn()
    addTerminalOutputCallback('output-test', outCb)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(outCb).not.toHaveBeenCalled()

    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(outCb).toHaveBeenCalledTimes(1)

    removeTerminalOutputCallback('output-test', outCb)
    removeTerminalInstance('output-test')
  })
})
