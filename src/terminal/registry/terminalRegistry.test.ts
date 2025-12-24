import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireTerminalInstance,
  attachTerminalInstance,
  detachTerminalInstance,
  removeTerminalInstance,
  isTerminalBracketedPasteEnabled,
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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('stream-test', factory)
    attachTerminalInstance('stream-test', document.createElement('div'))

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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('clear-test', factory)
    attachTerminalInstance('clear-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    // Simulate some output followed by a clear sequence
    listener('old content')
    listener('\x1b[3J') // Clear scrollback sequence

    await vi.runAllTimersAsync()

    // Only the clear sequence should be written (old content cleared)
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('\x1b[3J', expect.any(Function))

    removeTerminalInstance('clear-test')
  })

  it('tracks bracketed paste mode from output sequences (including split chunks)', async () => {
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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('paste-mode-test', factory)
    attachTerminalInstance('paste-mode-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(false)

    listener('\x1b[?20')
    listener('04h')
    await vi.runAllTimersAsync()
    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(true)

    listener('\x1b[?200')
    listener('4l')
    await vi.runAllTimersAsync()
    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(false)

    removeTerminalInstance('paste-mode-test')
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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('alternate-buffer-test', factory)
    attachTerminalInstance('alternate-buffer-test', document.createElement('div'))

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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('cursor-move-test', factory)
    attachTerminalInstance('cursor-move-test', document.createElement('div'))

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
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-follow-test', factory)
    attachTerminalInstance('tui-follow-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('tui-follow-test')
  })

  it('strips clear scrollback sequence in TUI mode to prevent viewport jumps', async () => {
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
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-clear-test', factory)
    attachTerminalInstance('tui-clear-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('some content\x1b[3Jmore content')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('some contentmore content', expect.any(Function))

    removeTerminalInstance('tui-clear-test')
  })

  it('holds TUI clear-screen redraw until content arrives', async () => {
    const rawWrite = vi.fn()
    const rawWriteSync = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          writeSync: rawWriteSync,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-deferral-test', factory)
    attachTerminalInstance('tui-deferral-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('\x1b[2J\x1b[H')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).not.toHaveBeenCalled()

    listener('hello')
    await vi.runOnlyPendingTimersAsync()

    expect(rawWrite).not.toHaveBeenCalled()
    expect(rawWriteSync).toHaveBeenCalledTimes(1)
    expect(rawWriteSync).toHaveBeenCalledWith('\x1b[?2026h\x1b[2J\x1b[Hhello\x1b[?2026l')

    removeTerminalInstance('tui-deferral-test')
  })

  it('does not start a second TUI write while the first one is still parsing', async () => {
    let pendingWriteCallback: (() => void) | undefined
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      pendingWriteCallback = cb as (() => void) | undefined
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-parse-barrier-test', factory)
    attachTerminalInstance('tui-parse-barrier-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('first')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    // Parsing still in flight (callback not invoked), second chunk should not trigger another write yet.
    listener('second')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    // Once parsing completes, the buffered chunk should flush.
    pendingWriteCallback?.()
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(2)

    removeTerminalInstance('tui-parse-barrier-test')
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
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('output-test', factory)
    attachTerminalInstance('output-test', document.createElement('div'))

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

  it('buffers output while detached and flushes when reattached', async () => {
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
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('detach-buffer-test', factory)
    attachTerminalInstance('detach-buffer-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('a')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)
    const firstWriteCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    firstWriteCallback()

    detachTerminalInstance('detach-buffer-test')

    listener('b')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    attachTerminalInstance('detach-buffer-test', document.createElement('div'))
    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(2)
    expect(rawWrite).toHaveBeenLastCalledWith('b', expect.any(Function))

    removeTerminalInstance('detach-buffer-test')
  })
})
