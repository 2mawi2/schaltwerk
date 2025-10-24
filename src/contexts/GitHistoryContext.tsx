import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { HistoryProviderSnapshot } from '../components/git-graph/types'
import { logger } from '../utils/logger'

type FetchMode = 'initial' | 'append' | 'refresh'

interface RepoHistoryEntry {
  snapshot: HistoryProviderSnapshot | null
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  loadMoreError: string | null
  latestHead: string | null
}

interface GitHistoryContextValue {
  version: number
  getState: (repoPath: string) => RepoHistoryEntry
  ensureLoaded: (repoPath: string) => Promise<void>
  loadMore: (repoPath: string, cursor?: string) => Promise<void>
  refresh: (repoPath: string) => Promise<void>
}

const DEFAULT_ENTRY: RepoHistoryEntry = Object.freeze({
  snapshot: null,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  loadMoreError: null,
  latestHead: null,
})

const HISTORY_PAGE_SIZE = 100

const GitHistoryContext = createContext<GitHistoryContextValue | undefined>(undefined)

function buildUpdatedEntry(
  entry: RepoHistoryEntry,
  snapshot: HistoryProviderSnapshot,
  mode: FetchMode,
): RepoHistoryEntry {
  if (snapshot.unchanged) {
    return {
      ...entry,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      loadMoreError: null,
      latestHead: snapshot.headCommit ?? entry.latestHead,
      snapshot: entry.snapshot,
    }
  }

  const previousSnapshot = entry.snapshot

  if (mode === 'append' && previousSnapshot) {
    const existingKeys = new Set(
      previousSnapshot.items.map(item => item.fullHash ?? item.id),
    )

    const deduped = snapshot.items.filter(item => {
      const key = item.fullHash ?? item.id
      if (existingKeys.has(key)) {
        return false
      }
      existingKeys.add(key)
      return true
    })

    const merged: HistoryProviderSnapshot = {
      ...previousSnapshot,
      items: [...previousSnapshot.items, ...deduped],
      nextCursor: snapshot.nextCursor,
      hasMore: snapshot.hasMore,
      currentRef: snapshot.currentRef ?? previousSnapshot.currentRef,
      currentRemoteRef: snapshot.currentRemoteRef ?? previousSnapshot.currentRemoteRef,
      currentBaseRef: snapshot.currentBaseRef ?? previousSnapshot.currentBaseRef,
      headCommit: snapshot.headCommit ?? previousSnapshot.headCommit,
      unchanged: snapshot.unchanged,
    }

    return {
      snapshot: merged,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      loadMoreError: null,
      latestHead:
        merged.headCommit ??
        merged.items[0]?.fullHash ??
        entry.latestHead,
    }
  }

  const resolvedHead =
    snapshot.headCommit ??
    snapshot.items[0]?.fullHash ??
    previousSnapshot?.headCommit ??
    entry.latestHead

  return {
    snapshot: {
      ...snapshot,
      headCommit: resolvedHead ?? snapshot.headCommit,
    },
    isLoading: false,
    isLoadingMore: false,
    error: null,
    loadMoreError: null,
    latestHead: resolvedHead ?? null,
  }
}

export function GitHistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Map<string, RepoHistoryEntry>>(new Map())
  const [version, setVersion] = useState(0)
  const requestsRef = useRef(new Map<string, Promise<void>>())
  const entriesRef = useRef(entries)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const getState = useCallback((repoPath: string): RepoHistoryEntry => {
    return entriesRef.current.get(repoPath) ?? DEFAULT_ENTRY
  }, [])

  const updateEntry = useCallback(
    (repoPath: string, updater: (entry: RepoHistoryEntry) => RepoHistoryEntry) => {
      let didChange = false
      setEntries(prev => {
        const current = prev.get(repoPath) ?? DEFAULT_ENTRY
        const nextEntry = updater(current)
        if (nextEntry === current) {
          return prev
        }

        didChange = true
        const updated = new Map(prev)
        updated.set(repoPath, nextEntry)
        return updated
      })
      if (didChange) {
        setVersion(prev => prev + 1)
      }
    },
    [],
  )

  const runFetch = useCallback(
    async (repoPath: string, mode: FetchMode, cursor?: string) => {
      if (!repoPath) {
        return
      }

      const existing = requestsRef.current.get(repoPath)
      if (existing) {
        await existing
        if (mode === 'refresh') {
          // The previous request has finished; retry the refresh now.
          return runFetch(repoPath, 'refresh')
        }
      }

      updateEntry(repoPath, entry => {
        if (mode === 'initial') {
          return {
            ...entry,
            isLoading: true,
            error: null,
          }
        }

        if (mode === 'append') {
          return {
            ...entry,
            isLoadingMore: true,
            loadMoreError: null,
          }
        }

        return {
          ...entry,
          isLoading: true,
          error: null,
        }
      })

      const sinceHead =
        mode === 'refresh' ? entriesRef.current.get(repoPath)?.latestHead ?? null : null

      const request = (async () => {
        try {
          const snapshot = await invoke<HistoryProviderSnapshot>(
            TauriCommands.GetGitGraphHistory,
            {
              repoPath,
              limit: HISTORY_PAGE_SIZE,
              cursor,
              sinceHead,
            },
          )

          updateEntry(repoPath, entry =>
            buildUpdatedEntry(entry, snapshot, mode),
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (mode === 'append') {
            updateEntry(repoPath, entry => ({
              ...entry,
              isLoadingMore: false,
              loadMoreError: message,
            }))
          } else {
            updateEntry(repoPath, entry => ({
              ...entry,
              isLoading: false,
              error: message,
            }))
          }
          logger.error('[GitHistoryContext] Failed to fetch git history', error)
        } finally {
          requestsRef.current.delete(repoPath)
        }
      })()

      requestsRef.current.set(
        repoPath,
        request,
      )

      await request
    },
    [updateEntry],
  )

  const ensureLoaded = useCallback(
    async (repoPath: string) => {
      if (!repoPath) {
        return
      }

      const entry = getState(repoPath)
      if (entry.snapshot || entry.isLoading) {
        return
      }

      await runFetch(repoPath, 'initial')
    },
    [getState, runFetch],
  )

  const loadMore = useCallback(
    async (repoPath: string, cursor?: string) => {
      if (!repoPath || !cursor) {
        return
      }
      await runFetch(repoPath, 'append', cursor)
    },
    [runFetch],
  )

  const refresh = useCallback(
    async (repoPath: string) => {
      if (!repoPath) {
        return
      }
      await runFetch(repoPath, 'refresh')
    },
    [runFetch],
  )

  const contextValue = useMemo<GitHistoryContextValue>(
    () => ({
      version,
      getState,
      ensureLoaded,
      loadMore,
      refresh,
    }),
    [version, getState, ensureLoaded, loadMore, refresh],
  )

  return (
    <GitHistoryContext.Provider value={contextValue}>
      {children}
    </GitHistoryContext.Provider>
  )
}

function noopPromise(): Promise<void> {
  return Promise.resolve()
}

export function useGitHistory(repoPath: string | null | undefined) {
  const context = useContext(GitHistoryContext)
  if (!context) {
    throw new Error('useGitHistory must be used within a GitHistoryProvider')
  }

  const normalized = repoPath ?? null

  return useMemo(() => {
    if (!normalized) {
      return {
        snapshot: null,
        isLoading: false,
        isLoadingMore: false,
        error: null,
        loadMoreError: null,
        latestHead: null,
        ensureLoaded: noopPromise,
        loadMore: noopPromise,
        refresh: noopPromise,
      }
    }

    const state = context.getState(normalized)

    return {
      snapshot: state.snapshot,
      isLoading: state.isLoading,
      isLoadingMore: state.isLoadingMore,
      error: state.error,
      loadMoreError: state.loadMoreError,
      latestHead: state.latestHead,
      ensureLoaded: () => context.ensureLoaded(normalized),
      loadMore: (cursor?: string | null) =>
        cursor ? context.loadMore(normalized, cursor) : Promise.resolve(),
      refresh: () => context.refresh(normalized),
    }
  }, [context, normalized])
}
