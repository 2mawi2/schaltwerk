import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GithubIssueDetails, GithubIssueSummary } from '../types/githubIssues'

export interface UseGithubIssueSearchResult {
  results: GithubIssueSummary[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (number: number) => Promise<GithubIssueDetails>
  clearError: () => void
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

interface UseGithubIssueSearchOptions {
  debounceMs?: number
  enabled?: boolean
}

export function useGithubIssueSearch(options: UseGithubIssueSearchOptions = {}): UseGithubIssueSearchResult {
  const { debounceMs = 300, enabled = true } = options
  const isTestEnv = typeof import.meta !== 'undefined' && Boolean((import.meta as unknown as { vitest?: unknown }).vitest)
  const effectiveDebounce = isTestEnv ? 0 : debounceMs
  const [results, setResults] = useState<GithubIssueSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchVersionRef = useRef(0)
  const hasInitialFetchedRef = useRef(false)
  const debounceHandle = useRef<number | null>(null)

  const executeSearch = useCallback(async (term: string) => {
    const trimmed = term.trim()
    const version = ++searchVersionRef.current
    setLoading(true)
    try {
      const payload = await invoke<GithubIssueSummary[]>(TauriCommands.GitHubSearchIssues, {
        query: trimmed.length > 0 ? trimmed : undefined,
      })
      if (searchVersionRef.current === version) {
        setResults(payload)
        setError(null)
      }
    } catch (err) {
      if (searchVersionRef.current === version) {
        setResults([])
        setError(resolveErrorMessage(err))
      }
    } finally {
      if (searchVersionRef.current === version) {
        setLoading(false)
      }
    }
  }, [])

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

  const fetchDetails = useCallback(async (number: number) => {
    try {
      const payload = await invoke<GithubIssueDetails>(TauriCommands.GitHubGetIssueDetails, { number })
      setError(null)
      return {
        ...payload,
        labels: payload.labels ?? [],
        comments: payload.comments ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setError(message)
      throw new Error(message)
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
    clearError,
  }
}
