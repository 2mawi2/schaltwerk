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
      worker.dispatchMessage({ id: request!.id, result: '<span>highlighted</span>' })
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
      worker.dispatchMessage({ id: request!.id, result: 'ignored', error: 'boom' })
    })

    await waitFor(() => {
      expect(result.current.highlightCode({ code: 'let x = 0', language: 'javascript' })).toBe('let x = 0')
    })

    expect(loggerErrorSpy).toHaveBeenCalled()
  })
})
