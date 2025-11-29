import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { acquireTerminalInstance, removeTerminalInstance } from './terminalRegistry'
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

  it('flushes pending chunks even when chunks arrive continuously', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: { write: rawWrite },
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

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('abc')

    removeTerminalInstance('stream-test')
  })
})
