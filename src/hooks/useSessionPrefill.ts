import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface SessionPrefillData {
  name: string
  taskContent: string
  baseBranch?: string
  lockName?: boolean
  fromDraft?: boolean
}

export interface SessionData {
  draft_content?: string | null
  initial_prompt?: string | null
  parent_branch?: string | null
}

/**
 * Extracts the session content from the session data
 * Prioritizes draft_content over initial_prompt
 */
export function extractSessionContent(sessionData: SessionData | null): string {
  if (!sessionData) return ''
  return sessionData.draft_content ?? sessionData.initial_prompt ?? ''
}

/**
 * Hook for fetching and preparing session data for prefilling the new session modal
 */
export function useSessionPrefill() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSessionForPrefill = useCallback(async (sessionName: string): Promise<SessionPrefillData | null> => {
    setIsLoading(true)
    setError(null)

    try {
      const sessionData = await invoke<SessionData>('schaltwerk_core_get_session', { name: sessionName })
      const taskContent = extractSessionContent(sessionData)
      const baseBranch = sessionData?.parent_branch || undefined

      return {
        name: sessionName,
        taskContent,
        baseBranch,
        lockName: true,
        fromDraft: true,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(errorMessage)
      console.error('Failed to fetch session for prefill:', errorMessage)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    fetchSessionForPrefill,
    isLoading,
    error,
  }
}