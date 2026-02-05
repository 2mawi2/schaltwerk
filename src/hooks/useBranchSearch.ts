import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

const MAX_RESULTS = 50

interface UseBranchSearchOptions {
  enabled?: boolean
}

export interface UseBranchSearchResult {
  branches: string[]
  filteredBranches: string[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
}

function filterBranches(branches: string[], query: string): string[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return branches.slice(0, MAX_RESULTS)
  }

  const exact: string[] = []
  const startsWith: string[] = []
  const contains: string[] = []

  for (const branch of branches) {
    const lower = branch.toLowerCase()
    if (lower === trimmed) {
      exact.push(branch)
    } else if (lower.startsWith(trimmed)) {
      startsWith.push(branch)
    } else if (lower.includes(trimmed)) {
      contains.push(branch)
    }
  }

  return [...exact, ...startsWith, ...contains].slice(0, MAX_RESULTS)
}

export function useBranchSearch(options: UseBranchSearchOptions = {}): UseBranchSearchResult {
  const { enabled = true } = options
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const fetchBranches = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await invoke<string[]>(TauriCommands.ListProjectBranches)
      setBranches(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
      logger.error('Failed to fetch branches:', err)
      setBranches([])
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setBranches([])
      setLoading(false)
      return
    }
    void fetchBranches()
  }, [enabled, fetchBranches])

  const filteredBranches = useMemo(
    () => filterBranches(branches, query),
    [branches, query]
  )

  return {
    branches,
    filteredBranches,
    loading,
    error,
    query,
    setQuery,
  }
}
