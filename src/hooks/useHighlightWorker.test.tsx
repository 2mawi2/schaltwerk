import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useHighlightWorker } from './useHighlightWorker'
import { logger } from '../utils/logger'
import type { SyntaxHighlightRequest, SyntaxHighlightResponse } from '../workers/syntaxHighlighter.worker'

type MessageEventHandler = (event: { data: SyntaxHighlightResponse }) => void
type ErrorEventHandler = (event: { message: string }) => void

class MockWorker {
  static lastInstance: MockWorker | null = null

  public listeners: { message: MessageEventHandler[]; error: ErrorEventHandler[] } = {
    message: [],
    error: []
  }

  public messages: SyntaxHighlightRequest[] = []
  public terminated = false

  constructor(..._args: unknown[]) {
    MockWorker.lastInstance = this
  }

  postMessage(payload: SyntaxHighlightRequest) {
    this.messages.push(payload)
  }

  addEventListener(type: 'message', listener: MessageEventHandler): void
  addEventListener(type: 'error', listener: ErrorEventHandler): void
  addEventListener(type: 'message' | 'error', listener: MessageEventHandler | ErrorEventHandler) {
    if (type === 'message') {
      this.listeners.message.push(listener as MessageEventHandler)
    } else {
      this.listeners.error.push(listener as ErrorEventHandler)
    }
  }

  removeEventListener(type: 'message', listener: MessageEventHandler): void
  removeEventListener(type: 'error', listener: ErrorEventHandler): void
  removeEventListener(type: 'message' | 'error', listener: MessageEventHandler | ErrorEventHandler) {
    if (type === 'message') {
      this.listeners.message = this.listeners.message.filter(entry => entry !== listener)
    } else {
      this.listeners.error = this.listeners.error.filter(entry => entry !== listener)
    }
  }

  terminate() {
    this.terminated = true
  }

  dispatchMessage(data: SyntaxHighlightResponse) {
    const event = { data }
    this.listeners.message.forEach(listener => listener(event))
  }

  dispatchError(message: string) {
    const event = { message }
    this.listeners.error.forEach(listener => listener(event))
  }
}

describe('useHighlightWorker', () => {
  const originalWorker = globalThis.Worker
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    MockWorker.lastInstance = null
    // @ts-expect-error override for test environment
    globalThis.Worker = MockWorker
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    loggerErrorSpy.mockRestore()
    if (originalWorker) {
      globalThis.Worker = originalWorker
    } else {
      // @ts-expect-error cleanup when Worker was undefined
      delete globalThis.Worker
    }
  })

  it('returns highlighted code after worker response', async () => {
    const { result } = renderHook(() => useHighlightWorker())

    let firstPass = ''
    act(() => {
      firstPass = result.current.highlightCode({ code: 'const value = 1', language: 'typescript' })
    })

    expect(firstPass).toBe('const value = 1')

    await waitFor(() => {
      expect(MockWorker.lastInstance).not.toBeNull()
    })

    const worker = MockWorker.lastInstance!

    let secondPass = ''
    act(() => {
      secondPass = result.current.highlightCode({ code: 'const value = 1', language: 'typescript' })
    })

    expect(secondPass).toBe('const value = 1')

    const request = worker.messages.at(-1)
    expect(request).toMatchObject({ code: 'const value = 1', language: 'typescript' })

    act(() => {
      worker.dispatchMessage({ id: request!.id, type: 'single', result: '<span>highlighted</span>' })
    })

    await waitFor(() => {
      const highlighted = result.current.highlightCode({ code: 'const value = 1', language: 'typescript' })
      expect(highlighted).toBe('<span>highlighted</span>')
    })
  })

  it('bypasses worker when bypass flag is set', () => {
    const { result } = renderHook(() => useHighlightWorker())

    let output = ''
    act(() => {
      output = result.current.highlightCode({ code: 'function noop() {}', bypass: true })
    })

    expect(output).toBe('function noop() {}')
    expect(MockWorker.lastInstance?.messages ?? []).toHaveLength(0)
  })

  it('highlights blocks of lines and caches results', async () => {
    const { result } = renderHook(() => useHighlightWorker())

    act(() => {
      result.current.requestBlockHighlight({
        cacheKey: 'example.ts::0',
        lines: ['const value = 1;', 'console.log(value);'],
        language: 'typescript'
      })
    })

    await waitFor(() => {
      expect(MockWorker.lastInstance).not.toBeNull()
    })

    const worker = MockWorker.lastInstance!
    const request = worker.messages.at(-1)!
    expect(request).toMatchObject({
      type: 'block',
      lines: ['const value = 1;', 'console.log(value);']
    })

    expect(result.current.readBlockLine('example.ts::0', 0, 'fallback')).toBe('fallback')

    act(() => {
      worker.dispatchMessage({
        id: request.id,
        type: 'block',
        result: ['<span>hl-0</span>', '<span>hl-1</span>']
      })
    })

    await waitFor(() => {
      expect(result.current.readBlockLine('example.ts::0', 0, 'fallback')).toBe('<span>hl-0</span>')
      expect(result.current.readBlockLine('example.ts::0', 1, 'fallback')).toBe('<span>hl-1</span>')
    })

    act(() => {
      result.current.requestBlockHighlight({
        cacheKey: 'example.ts::0',
        lines: ['ignored'],
        language: 'typescript'
      })
    })

    const blockRequests = worker.messages.filter(message => message.type === 'block')
    expect(blockRequests).toHaveLength(1)
  })

  it('stores raw lines when block highlight is bypassed', () => {
    const { result } = renderHook(() => useHighlightWorker())

    act(() => {
      result.current.requestBlockHighlight({
        cacheKey: 'plain.txt::0',
        lines: ['no highlight needed'],
        bypass: true
      })
    })

    expect(MockWorker.lastInstance?.messages ?? []).toHaveLength(0)
    expect(result.current.readBlockLine('plain.txt::0', 0, 'fallback')).toBe('no highlight needed')
  })

  it('falls back to raw code when worker reports an error', async () => {
    const { result } = renderHook(() => useHighlightWorker())

    act(() => {
      result.current.highlightCode({ code: 'let x = 0', language: 'javascript' })
    })

    await waitFor(() => {
      expect(MockWorker.lastInstance).not.toBeNull()
    })

    const worker = MockWorker.lastInstance!

    act(() => {
      result.current.highlightCode({ code: 'let x = 0', language: 'javascript' })
    })

    const request = worker.messages.at(-1)
    expect(request).toBeDefined()

    act(() => {
      worker.dispatchMessage({ id: request!.id, type: 'single', result: 'ignored', error: 'boom' })
    })

    await waitFor(() => {
      expect(result.current.highlightCode({ code: 'let x = 0', language: 'javascript' })).toBe('let x = 0')
    })

    expect(loggerErrorSpy).toHaveBeenCalled()
  })
})
