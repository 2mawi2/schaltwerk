import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '../utils/logger'
import type { SyntaxHighlightRequest, SyntaxHighlightResponse } from '../workers/syntaxHighlighter.worker'

export interface HighlightOptions {
  code: string
  language?: string | null
  bypass?: boolean
  autoDetect?: boolean
}

export interface HighlightWorkerHandle {
  highlightCode: (options: HighlightOptions) => string
}

interface PendingRequest {
  key: string
  code: string
}

export function useHighlightWorker(): HighlightWorkerHandle {
  const workerRef = useRef<Worker | null>(null)
  const cacheRef = useRef<Map<string, string>>(new Map())
  const pendingByIdRef = useRef<Map<number, PendingRequest>>(new Map())
  const pendingByKeyRef = useRef<Map<string, number>>(new Map())
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

    const handleMessage = (event: MessageEvent<SyntaxHighlightResponse>) => {
      const { id, result, error } = event.data
      const pending = pendingById.get(id)

      if (!pending) {
        return
      }

      pendingById.delete(id)
      pendingByKey.delete(pending.key)

      const output = error ? pending.code : result
      if (error) {
        logger.error('Highlight worker failed', { error })
      }

      cache.set(pending.key, output)
      forceRender()
    }

    const handleError = (event: ErrorEvent) => {
      logger.error('Highlight worker crashed', { message: event.message })

      pendingById.forEach((pending) => {
        cache.set(pending.key, pending.code)
      })

      pendingById.clear()
      pendingByKey.clear()
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
        cache.set(pending.key, pending.code)
      })

      pendingById.clear()
      pendingByKey.clear()
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
      pendingByIdRef.current.set(requestId, { key: cacheKey, code })
      pendingByKeyRef.current.set(cacheKey, requestId)

      const payload: SyntaxHighlightRequest = {
        id: requestId,
        code,
        language: language ?? null,
        autoDetect
      }

      worker.postMessage(payload)
    }

    return code
  }, [])

  return { highlightCode }
}
