import { useCallback, useMemo, useRef } from 'react'
import { applyEnqueuePolicy, type QueueConfig } from '../utils/terminalQueue'
import { logger as defaultLogger } from '../utils/logger'

type LoggerLike = Pick<typeof defaultLogger, 'debug' | 'info' | 'warn' | 'error'>

type UseTerminalWriteQueueConfig = {
  queueConfig: QueueConfig
  logger?: LoggerLike
  overflowNoticeBuilder?: (droppedBytes: number) => string
  onOverflow?: (info: { droppedBytes: number }) => void
  debugTag?: string
}

type FlushReport = (writtenBytes: number) => void

type FlushCallback = (chunk: string, report: FlushReport) => boolean | void

type FlushOptions = {
  immediate?: boolean
}

type UseTerminalWriteQueueStats = {
  queuedBytes: number
  droppedBytes: number
  overflowActive: boolean
  queueLength: number
}

const defaultOverflowNotice = (droppedBytes: number) => {
  const droppedKB = Math.max(1, Math.round(droppedBytes / 1024))
  return `\r\n[schaltwerk] high-volume output; ${droppedKB}KB skipped in UI to stay responsive.\r\n`
}

const scheduleMicrotask = (cb: () => void) => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(cb)
  } else {
    Promise.resolve().then(cb)
  }
}

export function useTerminalWriteQueue({
  queueConfig,
  logger = defaultLogger,
  overflowNoticeBuilder = defaultOverflowNotice,
  onOverflow,
  debugTag
}: UseTerminalWriteQueueConfig) {
  const queueRef = useRef<string[]>([])
  const queuedBytesRef = useRef(0)
  const droppedBytesRef = useRef(0)
  const overflowActiveRef = useRef(false)
  const pendingFlushRef = useRef(false)
  const reportedBytesRef = useRef(0)

  const dequeueChunk = useCallback((limit: number) => {
    if (limit <= 0) return ''
    let taken = 0
    const pieces: string[] = []
    const queue = queueRef.current

    while (queue.length > 0 && taken < limit) {
      const next = queue[0]
      const room = limit - taken
      if (next.length <= room) {
        pieces.push(next)
        queue.shift()
        queuedBytesRef.current -= next.length
        taken += next.length
      } else {
        pieces.push(next.slice(0, room))
        queue[0] = next.slice(room)
        queuedBytesRef.current -= room
        taken += room
      }
    }

    return pieces.join('')
  }, [])

  const enqueue = useCallback(
    (data: string) => {
      if (data.length === 0) return

      const next = applyEnqueuePolicy(
        {
          queue: queueRef.current,
          queuedBytes: queuedBytesRef.current,
          droppedBytes: droppedBytesRef.current,
          overflowActive: overflowActiveRef.current
        },
        data,
        queueConfig
      )

      queueRef.current = next.queue
      queuedBytesRef.current = next.queuedBytes
      droppedBytesRef.current = next.droppedBytes

      if (!overflowActiveRef.current && next.overflowActive) {
        const notice = overflowNoticeBuilder(next.droppedBytes)
        if (notice.length > 0) {
          queueRef.current.push(notice)
          queuedBytesRef.current += notice.length
        }
        if (next.droppedBytes > 0) {
          try {
            onOverflow?.({ droppedBytes: next.droppedBytes })
          } catch (error) {
            logger.debug?.(
              debugTag
                ? `[TerminalWriteQueue:${debugTag}] overflow handler failed`
                : '[TerminalWriteQueue] overflow handler failed',
              error
            )
          }
        }
      }

      overflowActiveRef.current = next.overflowActive
    },
    [overflowNoticeBuilder, onOverflow, queueConfig, logger, debugTag]
  )

  const flushInternal = useCallback(
    (callback: FlushCallback) => {
      if (queueRef.current.length === 0) return

      const chunk = dequeueChunk(queueConfig.maxWriteChunk)
      if (chunk.length === 0) return

      let shouldRequeue = false
      let allowReports = true
      let reportedForChunk = 0

      try {
        const report: FlushReport = writtenBytes => {
          if (!allowReports) return
          if (!Number.isFinite(writtenBytes)) return
          const bounded = Math.max(0, Math.min(chunk.length - reportedForChunk, Math.trunc(writtenBytes)))
          if (bounded === 0) return
          reportedForChunk += bounded
          reportedBytesRef.current += bounded
        }

        const result = callback(chunk, report)
        if (result === false) {
          shouldRequeue = true
        }
      } catch (error) {
        shouldRequeue = true
        logger.debug?.(
          debugTag ? `[TerminalWriteQueue:${debugTag}] flush callback failed` : '[TerminalWriteQueue] flush callback failed',
          error
        )
      }

      if (shouldRequeue) {
        allowReports = false
        if (reportedForChunk > 0) {
          reportedBytesRef.current = Math.max(0, reportedBytesRef.current - reportedForChunk)
        }
        queueRef.current.unshift(chunk)
        queuedBytesRef.current += chunk.length
      }
    },
    [dequeueChunk, logger, queueConfig.maxWriteChunk, debugTag]
  )

  const flushPending = useCallback(
    (callback: FlushCallback, options?: FlushOptions) => {
      if (options?.immediate) {
        flushInternal(callback)
        return
      }

      if (pendingFlushRef.current) return

      pendingFlushRef.current = true
      scheduleMicrotask(() => {
        pendingFlushRef.current = false
        flushInternal(callback)
      })
    },
    [flushInternal]
  )

  const reset = useCallback(() => {
    queueRef.current = []
    queuedBytesRef.current = 0
    droppedBytesRef.current = 0
    overflowActiveRef.current = false
    pendingFlushRef.current = false
    reportedBytesRef.current = 0
  }, [])

  const stats = useCallback((): UseTerminalWriteQueueStats => ({
    queuedBytes: queuedBytesRef.current,
    droppedBytes: droppedBytesRef.current,
    overflowActive: overflowActiveRef.current,
    queueLength: queueRef.current.length
  }), [])

  const drainReportedBytes = useCallback(() => {
    const total = reportedBytesRef.current
    reportedBytesRef.current = 0
    return total
  }, [])

  return useMemo(
    () => ({
      enqueue,
      flushPending,
      reset,
      stats,
      drainReportedBytes
    }),
    [enqueue, flushPending, reset, stats, drainReportedBytes]
  )
}

export type { UseTerminalWriteQueueStats }
