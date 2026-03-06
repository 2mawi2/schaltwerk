import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabMrDetails, GitlabMrSummary, GitlabPipelinePayload, GitlabSource } from '../types/gitlabTypes'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'

export interface UseGitlabMrSearchResult {
  results: GitlabMrSummary[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => Promise<GitlabMrDetails>
  fetchPipeline: (sourceBranch: string, sourceProject: string, sourceHostname?: string) => Promise<GitlabPipelinePayload | null>
  clearError: () => void
}

interface UseGitlabMrSearchOptions {
  debounceMs?: number
  enabled?: boolean
  sources: GitlabSource[]
}

export function useGitlabMrSearch(options: UseGitlabMrSearchOptions): UseGitlabMrSearchResult {
  const { debounceMs = 300, enabled = true, sources } = options
  const isTestEnv = typeof import.meta !== 'undefined' && Boolean((import.meta as unknown as { vitest?: unknown }).vitest)
  const effectiveDebounce = isTestEnv ? 0 : debounceMs
  const [results, setResults] = useState<GitlabMrSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchVersionRef = useRef(0)
  const hasInitialFetchedRef = useRef(false)
  const debounceHandle = useRef<number | null>(null)

  const executeSearch = useCallback(async (term: string) => {
    const trimmed = term.trim()
    const version = ++searchVersionRef.current
    const enabledSources = sources.filter(s => s.mrsEnabled)

    if (enabledSources.length === 0) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const allResults = await Promise.all(
        enabledSources.map(source =>
          invoke<GitlabMrSummary[]>(TauriCommands.GitLabSearchMrs, {
            query: trimmed.length > 0 ? trimmed : undefined,
            sourceProject: source.projectPath,
            sourceHostname: source.hostname === 'gitlab.com' ? undefined : source.hostname,
            sourceLabel: source.label,
          }).catch(err => {
            logger.warn(`Failed to search GitLab MRs for source ${source.label}`, err)
            return [] as GitlabMrSummary[]
          })
        )
      )

      if (searchVersionRef.current !== version) return

      const merged = allResults.flat().sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
      setResults(merged)
    } catch (err) {
      if (searchVersionRef.current === version) {
        logger.error(`Failed to search GitLab MRs for query: ${trimmed}`, err)
        setResults([])
        setError(resolveErrorMessage(err))
      }
    } finally {
      if (searchVersionRef.current === version) {
        setLoading(false)
      }
    }
  }, [sources])

  useEffect(() => {
    if (!enabled) {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
      hasInitialFetchedRef.current = false
      setLoading(false)
      setResults([])
      return
    }

    if (!hasInitialFetchedRef.current) {
      hasInitialFetchedRef.current = true
      void executeSearch('')
    }
  }, [enabled, executeSearch])

  useEffect(() => {
    if (!enabled || !hasInitialFetchedRef.current) {
      return
    }

    if (effectiveDebounce === 0) {
      void executeSearch(query)
      return
    }

    if (debounceHandle.current) {
      window.clearTimeout(debounceHandle.current)
    }

    debounceHandle.current = window.setTimeout(() => {
      void executeSearch(query)
    }, effectiveDebounce)

    return () => {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
      }
    }
  }, [query, effectiveDebounce, executeSearch, enabled])

  const refresh = useCallback(() => {
    if (!enabled) {
      return
    }
    void executeSearch(query)
  }, [enabled, executeSearch, query])

  const fetchDetails = useCallback(async (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => {
    try {
      const payload = await invoke<GitlabMrDetails>(TauriCommands.GitLabGetMrDetails, {
        iid,
        sourceProject,
        sourceHostname: sourceHostname === 'gitlab.com' ? undefined : sourceHostname,
        sourceLabel,
      })
      setError(null)
      return {
        ...payload,
        labels: payload.labels ?? [],
        notes: payload.notes ?? [],
        reviewers: payload.reviewers ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setError(message)
      throw new Error(message)
    }
  }, [])

  const fetchPipeline = useCallback(async (sourceBranch: string, sourceProject: string, sourceHostname?: string): Promise<GitlabPipelinePayload | null> => {
    try {
      return await invoke<GitlabPipelinePayload | null>(TauriCommands.GitLabGetMrPipeline, {
        sourceBranch,
        sourceProject,
        sourceHostname: sourceHostname === 'gitlab.com' ? undefined : sourceHostname,
      })
    } catch (err) {
      logger.warn('Failed to fetch GitLab pipeline', err)
      return null
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    results,
    loading,
    error,
    query,
    setQuery,
    refresh,
    fetchDetails,
    fetchPipeline,
    clearError,
  }
}
