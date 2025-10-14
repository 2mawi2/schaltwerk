import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamingDecoder } from './useStreamingDecoder'

describe('useStreamingDecoder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not trigger sentinel for non-sentinel data', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('hello world')
    })

    expect(onSentinel).not.toHaveBeenCalled()
  })

  it('should detect sentinel and call onSentinel', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('__SCHALTWERK_RUN_EXIT__=0\r')
    })

    expect(onSentinel).toHaveBeenCalledWith('0')
  })

  it('should handle sentinel with newline terminator', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('__SCHALTWERK_RUN_EXIT__=1\n')
    })

    expect(onSentinel).toHaveBeenCalledWith('1')
  })

  it('should buffer incomplete sentinel data', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('__SCHALTWERK_RUN_EXIT__=')
    })

    expect(onSentinel).not.toHaveBeenCalled()

    act(() => {
      result.current.processChunk('42\r')
    })

    expect(onSentinel).toHaveBeenCalledWith('42')
  })

  it('should handle mixed content with sentinel', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('output before__SCHALTWERK_RUN_EXIT__=0\rafter')
    })

    expect(onSentinel).toHaveBeenCalledWith('0')
  })

  it('should ignore empty chunks', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('')
    })

    expect(onSentinel).not.toHaveBeenCalled()
  })

  it('should ignore whitespace-only chunks without sentinel', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('   ')
    })

    expect(onSentinel).not.toHaveBeenCalled()
  })

  it('should maintain buffer across multiple chunks', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('first')
      result.current.processChunk('second')
      result.current.processChunk('__SCHALTWERK_RUN_EXIT__=5\r')
    })

    expect(onSentinel).toHaveBeenCalledWith('5')
  })

  it('should handle multiple sentinels in sequence', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    act(() => {
      result.current.processChunk('__SCHALTWERK_RUN_EXIT__=0\r__SCHALTWERK_RUN_EXIT__=1\r')
    })

    expect(onSentinel).toHaveBeenCalledTimes(2)
    expect(onSentinel).toHaveBeenNthCalledWith(1, '0')
    expect(onSentinel).toHaveBeenNthCalledWith(2, '1')
  })

  it('should limit buffer size to prevent memory issues', () => {
    const onSentinel = vi.fn()
    const { result } = renderHook(() => useStreamingDecoder({ onSentinel }))

    const largeChunk = 'x'.repeat(3000)
    act(() => {
      result.current.processChunk(largeChunk)
    })

    expect(onSentinel).not.toHaveBeenCalled()
  })

  it('should flush decoder on unmount', () => {
    const onSentinel = vi.fn()
    const { unmount } = renderHook(() => useStreamingDecoder({ onSentinel }))

    unmount()
    expect(onSentinel).not.toHaveBeenCalled()
  })
})
