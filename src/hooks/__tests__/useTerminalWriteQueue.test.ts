import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTerminalWriteQueue } from '../useTerminalWriteQueue'
import type { QueueConfig } from '../../utils/terminalQueue'

type TestLogger = {
  debug: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

const createLogger = (): TestLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
})

describe('useTerminalWriteQueue', () => {
  let logger: TestLogger

  beforeEach(() => {
    logger = createLogger()
  })

  const baseQueueConfig: QueueConfig = {
    maxQueueBytes: 16,
    targetAfterDrop: 8,
    lowWaterMark: 4,
    maxWriteChunk: 4
  }

  it('flushes chunks respecting configured write chunk size when immediate', () => {
    const { result } = renderHook(() =>
      useTerminalWriteQueue({
        queueConfig: baseQueueConfig,
        logger
      })
    )

    const writes: string[] = []

    act(() => {
      result.current.enqueue('abcdefgh')
    })

    act(() => {
      result.current.flushPending((chunk, report) => {
        writes.push(chunk)
        report(chunk.length)
      }, { immediate: true })
    })

    expect(writes).toEqual(['abcd'])
    expect(result.current.stats()).toMatchObject({ queuedBytes: 4, queueLength: 1 })

    act(() => {
      result.current.flushPending((chunk, report) => {
        writes.push(chunk)
        report(chunk.length)
      }, { immediate: true })
    })

    expect(writes).toEqual(['abcd', 'efgh'])
    expect(result.current.stats()).toMatchObject({ queuedBytes: 0, queueLength: 0 })
  })

  it('coalesces microtask flush requests and writes once', async () => {
    const { result } = renderHook(() =>
      useTerminalWriteQueue({
        queueConfig: baseQueueConfig,
        logger
      })
    )

    const writeSpy = vi.fn()

    act(() => {
      result.current.enqueue('abcd')
      result.current.flushPending((chunk, report) => {
        writeSpy(chunk)
        report(chunk.length)
      })
      result.current.flushPending((chunk, report) => {
        writeSpy(chunk)
        report(chunk.length)
      })
    })

    expect(writeSpy).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy).toHaveBeenCalledWith('abcd')
    expect(result.current.stats()).toMatchObject({ queuedBytes: 0, queueLength: 0 })
  })

  it('emits a single overflow notice per overflow episode and tracks stats', () => {
    const overflowConfig: QueueConfig = {
      maxQueueBytes: 10,
      targetAfterDrop: 5,
      lowWaterMark: 3,
      maxWriteChunk: 16
    }

    const { result } = renderHook(() =>
      useTerminalWriteQueue({
        queueConfig: overflowConfig,
        logger
      })
    )

    act(() => {
      result.current.enqueue('AAAAA')
      result.current.enqueue('BBBBB')
      result.current.enqueue('CCCCC')
    })

    const statsAfterOverflow = result.current.stats()
    expect(statsAfterOverflow.overflowActive).toBe(true)
    expect(statsAfterOverflow.droppedBytes).toBeGreaterThan(0)

    const drained: string[] = []

    act(() => {
      while (result.current.stats().queueLength > 0) {
        result.current.flushPending((chunk, report) => {
          drained.push(chunk)
          report(chunk.length)
        }, { immediate: true })
      }
    })

    const combined = drained.join('')
    const overflowMatches = combined.match(/\[schaltwerk\] high-volume output/g) ?? []
    expect(overflowMatches.length).toBe(1)

    act(() => {
      result.current.reset()
    })

    expect(result.current.stats()).toEqual({
      queuedBytes: 0,
      droppedBytes: 0,
      overflowActive: false,
      queueLength: 0
    })
  })

  it('tracks reported bytes across flushes and resets after draining', () => {
    const { result } = renderHook(() =>
      useTerminalWriteQueue({
        queueConfig: baseQueueConfig,
        logger
      })
    )

    act(() => {
      result.current.enqueue('abcdefgh')
    })

    act(() => {
      result.current.flushPending((chunk, report) => {
        report(chunk.length - 1)
      }, { immediate: true })
    })

    act(() => {
      result.current.flushPending((chunk, report) => {
        report(chunk.length)
      }, { immediate: true })
    })

    expect(result.current.drainReportedBytes()).toBe(7)
    expect(result.current.drainReportedBytes()).toBe(0)

    const observed: number[] = []

    act(() => {
      result.current.enqueue('zz')
      result.current.flushPending((chunk, report) => {
        observed.push(chunk.length)
        report(chunk.length)
      }, { immediate: true })
    })

    expect(observed).toEqual([2])

    expect(result.current.drainReportedBytes()).toBe(2)
  })
})
