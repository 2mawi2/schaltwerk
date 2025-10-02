import { useCallback, useEffect, useState } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

interface SpecCacheEntry {
  content: string
  isStatic: boolean
}

const specCache = new Map<string, SpecCacheEntry>()

export function useSpecContentCache(sessionName: string, sessionState?: 'spec' | 'running' | 'reviewed') {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const isStatic = sessionState === 'running' || sessionState === 'reviewed'

    const cached = specCache.get(sessionName)
    if (cached) {
      setContent(cached.content)
      if (cached.isStatic) {
        setLoading(false)
        logger.debug(`[useSpecContentCache] Cache hit for static session: ${sessionName}`)
        return
      } else {
        setLoading(true)
      }
    } else {
      setContent('')
      setLoading(true)
    }

    setError(null)

    invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName })
      .then(([draftContent, initialPrompt]) => {
        if (!mounted) return
        const text: string = draftContent ?? initialPrompt ?? ''

        specCache.set(sessionName, {
          content: text,
          isStatic,
        })

        setContent(text)
        setLoading(false)

        if (isStatic) {
          logger.debug(`[useSpecContentCache] Cached static session: ${sessionName}`)
        }
      })
      .catch((e) => {
        if (!mounted) return
        logger.error('[useSpecContentCache] Failed to get spec content:', e)
        setError(String(e))
        setLoading(false)
      })

    return () => { mounted = false }
  }, [sessionName, sessionState])

  const updateContent = useCallback((value: string) => {
    setContent(value)
    specCache.set(sessionName, {
      content: value,
      isStatic: false,
    })
  }, [sessionName])

  const invalidateCache = useCallback(() => {
    specCache.delete(sessionName)
  }, [sessionName])

  return {
    content,
    loading,
    error,
    updateContent,
    invalidateCache,
  }
}

export function invalidateSpecCache(sessionName: string) {
  specCache.delete(sessionName)
}

export function clearAllSpecCache() {
  specCache.clear()
}
