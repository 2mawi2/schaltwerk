import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '../utils/logger'
import type {
  SyntaxHighlightBlockRequest,
  SyntaxHighlightBlockResponse,
  SyntaxHighlightResponse,
  SyntaxHighlightSingleRequest,
  SyntaxHighlightSingleResponse
} from '../workers/syntaxHighlighter.worker'

export interface HighlightOptions {
  code: string
  language?: string | null
  bypass?: boolean
  autoDetect?: boolean
}

export interface HighlightWorkerHandle {
  highlightCode: (options: HighlightOptions) => string
  requestBlockHighlight: (options: HighlightBlockOptions) => void
  readBlockLine: (cacheKey: string, index: number, fallback: string) => string
}

export interface HighlightBlockOptions {
  cacheKey: string
  lines: string[]
  language?: string | null
  bypass?: boolean
  autoDetect?: boolean
}

type PendingRequest = PendingSingleRequest | PendingBlockRequest

interface PendingSingleRequest {
  kind: 'single'
  key: string
  code: string
}

interface PendingBlockRequest {
  kind: 'block'
  cacheKey: string
  lines: string[]
}

export function useHighlightWorker(): HighlightWorkerHandle {
  const workerRef = useRef<Worker | null>(null)
  const cacheRef = useRef<Map<string, string>>(new Map())
  const pendingByIdRef = useRef<Map<number, PendingRequest>>(new Map())
  const pendingByKeyRef = useRef<Map<string, number>>(new Map())
  const pendingBlocksRef = useRef<Map<string, number>>(new Map())
  const blockCacheRef = useRef<Map<string, string[]>>(new Map())
  const requestIdRef = useRef(0)
  const [, setVersion] = useState(0)

  const forceRender = useCallback(() => {
    setVersion((value) => value + 1)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined' || workerRef.current) {
      return
    }

    let worker: Worker | null = null
    const cache = cacheRef.current
    const pendingById = pendingByIdRef.current
    const pendingByKey = pendingByKeyRef.current
    const pendingBlocks = pendingBlocksRef.current
    const blockCache = blockCacheRef.current

    const handleMessage = (event: MessageEvent<SyntaxHighlightResponse>) => {
      const { id, error } = event.data
      const pending = pendingById.get(id)

      if (!pending) {
        return
      }

      pendingById.delete(id)
      if (pending.kind === 'single') {
        pendingByKey.delete(pending.key)

        const typedResult = event.data as SyntaxHighlightSingleResponse
        const output = error ? pending.code : typedResult.result
        if (error) {
          logger.error('Highlight worker failed', { error })
        }

        cache.set(pending.key, output)
      } else {
        pendingBlocks.delete(pending.cacheKey)

        const typedResult = event.data as SyntaxHighlightBlockResponse
        const lines = error ? pending.lines : typedResult.result
        if (error) {
          logger.error('Highlight worker block failed', { error })
        }

        blockCache.set(pending.cacheKey, Array.isArray(lines) ? lines : pending.lines)
      }

      forceRender()
    }

    const handleError = (event: ErrorEvent) => {
      logger.error('Highlight worker crashed', { message: event.message })

      pendingById.forEach((pending) => {
        if (pending.kind === 'single') {
          cache.set(pending.key, pending.code)
        } else {
          blockCache.set(pending.cacheKey, pending.lines)
        }
      })

      pendingById.clear()
      pendingByKey.clear()
      pendingBlocks.clear()
      forceRender()
    }

    try {
      worker = new Worker(
        new URL('../workers/syntaxHighlighter.worker.ts', import.meta.url),
        { type: 'module' }
      )
      worker.addEventListener('message', handleMessage)
      worker.addEventListener('error', handleError)
      workerRef.current = worker
      forceRender()
    } catch (error) {
      logger.error('Failed to initialise highlight worker', { error })
      worker = null
    }

    return () => {
      if (!worker) return

      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.terminate()
      workerRef.current = null

      pendingById.forEach((pending) => {
        if (pending.kind === 'single') {
          cache.set(pending.key, pending.code)
        } else {
          blockCache.set(pending.cacheKey, pending.lines)
        }
      })

      pendingById.clear()
      pendingByKey.clear()
      pendingBlocks.clear()
    }
  }, [forceRender])

  const highlightCode = useCallback((options: HighlightOptions) => {
    const { code, language, bypass, autoDetect } = options

    if (!code) {
      return ''
    }

    const langKey = language && language.length > 0 ? language : 'auto'
    const cacheKey = `${langKey}::${code}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      return cached
    }

    if (bypass) {
      return code
    }

    const worker = workerRef.current
    if (!worker) {
      return code
    }

    if (!pendingByKeyRef.current.has(cacheKey)) {
      const requestId = requestIdRef.current++
      pendingByIdRef.current.set(requestId, { kind: 'single', key: cacheKey, code })
      pendingByKeyRef.current.set(cacheKey, requestId)

      const payload: SyntaxHighlightSingleRequest = {
        id: requestId,
        type: 'single',
        code,
        language: language ?? null,
        autoDetect
      }

      worker.postMessage(payload)
    }

    return code
  }, [])

  const requestBlockHighlight = useCallback((options: HighlightBlockOptions) => {
    const { cacheKey, lines, language, bypass, autoDetect } = options

    if (!cacheKey) {
      return
    }

    if (!lines || lines.length === 0) {
      blockCacheRef.current.set(cacheKey, [])
      return
    }

    if (blockCacheRef.current.has(cacheKey)) {
      return
    }

    if (bypass) {
      blockCacheRef.current.set(cacheKey, lines.slice())
      forceRender()
      return
    }

    const worker = workerRef.current
    if (!worker) {
      blockCacheRef.current.set(cacheKey, lines.slice())
      forceRender()
      return
    }

    if (pendingBlocksRef.current.has(cacheKey)) {
      return
    }

    const requestId = requestIdRef.current++
    pendingByIdRef.current.set(requestId, { kind: 'block', cacheKey, lines: lines.slice() })
    pendingBlocksRef.current.set(cacheKey, requestId)

    const payload: SyntaxHighlightBlockRequest = {
      id: requestId,
      type: 'block',
      lines,
      language: language ?? null,
      autoDetect
    }

    worker.postMessage(payload)
  }, [forceRender])

  const readBlockLine = useCallback((cacheKey: string, index: number, fallback: string) => {
    const block = blockCacheRef.current.get(cacheKey)
    if (!block) {
      return fallback
    }
    return block[index] ?? fallback
  }, [])

  return { highlightCode, requestBlockHighlight, readBlockLine }
}
