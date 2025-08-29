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
  spec_content?: string | null
  initial_prompt?: string | null
  parent_branch?: string | null
}

/**
 * Extracts the session content from the session data
 * Prioritizes spec_content, then draft_content, then initial_prompt
 */
export function extractSessionContent(sessionData: SessionData | null): string {
  if (!sessionData) return ''
  // Check spec_content first (for spec sessions), then draft_content, then initial_prompt
  return sessionData.spec_content ?? sessionData.draft_content ?? sessionData.initial_prompt ?? ''
}

/**
 * Hook for fetching and preparing session data for prefilling the new session modal
 */
export function useSessionPrefill() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSessionForPrefill = useCallback(async (sessionName: string): Promise<SessionPrefillData | null> => {
    console.log('[useSessionPrefill] Fetching session for prefill:', sessionName)
    setIsLoading(true)
    setError(null)

    try {
      const sessionData = await invoke<SessionData>('schaltwerk_core_get_session', { name: sessionName })
      console.log('[useSessionPrefill] Raw session data:', sessionData)
      
      const taskContent = extractSessionContent(sessionData)
      console.log('[useSessionPrefill] Extracted agent content:', taskContent?.substring(0, 100), '...')
      
      const baseBranch = sessionData?.parent_branch || undefined
      console.log('[useSessionPrefill] Base branch:', baseBranch)

      const prefillData = {
        name: sessionName,
        taskContent,
        baseBranch,
        lockName: true,
        fromDraft: true,
      }
      console.log('[useSessionPrefill] Returning prefill data:', prefillData)
      return prefillData
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(errorMessage)
      console.error('[useSessionPrefill] Failed to fetch session for prefill:', errorMessage)
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