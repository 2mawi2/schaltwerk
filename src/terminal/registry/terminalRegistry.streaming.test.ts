import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../stream/terminalOutputManager', () => {
  const listenerMap = new Map<string, (chunk: string) => void>()

  return {
    terminalOutputManager: {
      addListener: vi.fn((id: string, listener: (chunk: string) => void) => {
        listenerMap.set(id, listener)
      }),
      removeListener: vi.fn((id: string, listener: (chunk: string) => void) => {
        const current = listenerMap.get(id)
        if (current === listener) {
          listenerMap.delete(id)
        }
      }),
      ensureStarted: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    },
    __listeners: listenerMap,
  }
})

vi.mock('../xterm/XtermTerminal', () => {
  let writeTarget: string[] | null = null

  class MockXtermTerminal {
    raw = {
      write: (data: string) => {
        writeTarget?.push(data)
      },
    }

    attach() {}
    detach() {}
    dispose() {}

    // Unused in these tests but present on the real class
    fitAddon = null
    searchAddon = null
    webLinksAddon = null
  }

  return {
    XtermTerminal: MockXtermTerminal,
    __setWriteTarget: (target: string[]) => {
      writeTarget = target
    },
  }
})

import { acquireTerminalInstance, releaseTerminalInstance } from './terminalRegistry'
import * as OutputManagerModule from '../stream/terminalOutputManager'
import * as XtermModule from '../xterm/XtermTerminal'
import type { XtermTerminalOptions } from '../xterm/XtermTerminal'

const mockedOutputManager = OutputManagerModule as unknown as typeof OutputManagerModule & {
  __listeners: Map<string, (chunk: string) => void>
}

const mockedXtermModule = XtermModule as unknown as typeof XtermModule & {
  __setWriteTarget: (target: string[]) => void
}

describe('terminalRegistry streaming flush', () => {
  const terminalId = 'stream-flush-terminal'

  let now = 0
  let rafQueue: FrameRequestCallback[] = []

  const runFrame = (advanceMs: number) => {
    now += advanceMs
    const callbacks = [...rafQueue]
    rafQueue = []
    callbacks.forEach(cb => cb(now))
  }

  beforeEach(() => {
    now = 0
    rafQueue = []

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    })

    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const index = id - 1
      if (index >= 0 && index < rafQueue.length) {
        rafQueue.splice(index, 1)
      }
    })

    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    mockedOutputManager.__listeners.clear()
  })

  it('flushes batches even when output never pauses for 16ms', () => {
    const writes: string[] = []
    mockedXtermModule.__setWriteTarget(writes)

    const opts: XtermTerminalOptions = {
      terminalId,
      config: {
        scrollback: 100,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1,
        smoothScrolling: false,
      },
    }

    acquireTerminalInstance(terminalId, () => new mockedXtermModule.XtermTerminal(opts))

    const listener = mockedOutputManager.__listeners.get(terminalId)
    expect(listener).toBeDefined()

    const emitAt = (timeMs: number, chunk: string) => {
      now = timeMs
      listener?.(chunk)
    }

    // Chunks every 5ms leading into the first frame
    emitAt(0, 'a')
    emitAt(5, 'b')
    emitAt(10, 'c')
    emitAt(15, 'd')

    // First frame happens 1ms later (16ms total) – should flush despite no idle gap
    runFrame(1)

    expect(writes.length).toBeGreaterThan(0)
    expect(writes[0]).toBe('abcd')

    // Keep streaming without a 16ms gap and expect another flush on the next frame
    emitAt(20, 'e')
    emitAt(25, 'f')

    runFrame(7) // now = 32ms, still <16ms since last chunk

    expect(writes.length).toBe(2)
    expect(writes[1]).toBe('ef')

    releaseTerminalInstance(terminalId)
  })

  it('splits large bursts across multiple animation frames', () => {
    const writes: string[] = []
    mockedXtermModule.__setWriteTarget(writes)

    const opts: XtermTerminalOptions = {
      terminalId,
      config: {
        scrollback: 100,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1,
        smoothScrolling: false,
      },
    }

    acquireTerminalInstance(terminalId, () => new mockedXtermModule.XtermTerminal(opts))

    const listener = mockedOutputManager.__listeners.get(terminalId)
    expect(listener).toBeDefined()

    const chunk = 'x'.repeat(6_000)

    // Emit a single large burst
    now = 0
    listener?.(chunk)

    // First frame: should flush only part of the burst
    runFrame(1)

    expect(writes.length).toBe(1)
    expect(writes[0].length).toBeLessThan(chunk.length)
    expect(writes[0].length).toBeGreaterThan(0)

    // Next frame: should flush the remainder
    runFrame(16)

    expect(writes.length).toBe(2)
    expect(writes[0].length + writes[1].length).toBe(chunk.length)
    expect(writes[1].length).toBeGreaterThan(0)

    releaseTerminalInstance(terminalId)
  })
})
