import { atom, type Getter, type Setter } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { invoke } from '@tauri-apps/api/core'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import type { HistoryItem, HistoryProviderSnapshot } from '../../components/git-graph/types'
import { logger } from '../../utils/logger'
import { fuzzyMatch } from '../../utils/fuzzyMatch'

type FetchMode = 'initial' | 'append' | 'refresh'

export interface RepoHistoryEntry {
  snapshot: HistoryProviderSnapshot | null
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  loadMoreError: string | null
  latestHead: string | null
}

export interface GitHistoryFilter {
  searchText: string
  author: string | null
}

export interface GitHistoryRefreshOptions {
  sinceHeadOverride?: string | null
}

const DEFAULT_ENTRY: RepoHistoryEntry = Object.freeze({
  snapshot: null,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  loadMoreError: null,
  latestHead: null,
})

const DEFAULT_FILTER: GitHistoryFilter = Object.freeze({
  searchText: '',
  author: null,
})

const HISTORY_PAGE_SIZE = 100
const MAX_HISTORY_ITEMS = 1000

const inflightRequests = new Map<string, Promise<void>>()

export const gitHistoryEntriesAtom = atom<Map<string, RepoHistoryEntry>>(new Map())
const gitHistoryFiltersAtom = atom<Map<string, GitHistoryFilter>>(new Map())

function getHistoryItemKey(item: HistoryProviderSnapshot['items'][number]): string {
  return item.fullHash ?? item.id
}

function updateEntry(get: Getter, set: Setter, repoPath: string, updater: (entry: RepoHistoryEntry) => RepoHistoryEntry) {
  const currentEntries = get(gitHistoryEntriesAtom)
  const current = currentEntries.get(repoPath) ?? DEFAULT_ENTRY
  const nextEntry = updater(current)
  if (nextEntry === current) {
    return
  }

  const updated = new Map(currentEntries)
  updated.set(repoPath, nextEntry)
  set(gitHistoryEntriesAtom, updated)
}

function buildUpdatedEntry(
  entry: RepoHistoryEntry,
  snapshot: HistoryProviderSnapshot,
  mode: FetchMode,
  repoPath: string,
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
    const existingKeys = new Set(previousSnapshot.items.map(getHistoryItemKey))

    const deduped = snapshot.items.filter(item => {
      const key = getHistoryItemKey(item)
      if (existingKeys.has(key)) {
        return false
      }
      existingKeys.add(key)
      return true
    })

    const mergedNextCursor =
      snapshot.hasMore === false ? undefined : snapshot.nextCursor ?? undefined

    if (deduped.length === 0 && previousSnapshot.nextCursor && !mergedNextCursor) {
      logger.debug('[gitHistoryAtom] Append delivered duplicate page, clearing cursor after backend exhausted history', {
        repoPath,
        previousCursor: previousSnapshot.nextCursor,
      })
    }

    const merged: HistoryProviderSnapshot = {
      ...previousSnapshot,
      items: [...previousSnapshot.items, ...deduped],
      nextCursor: mergedNextCursor,
      hasMore:
        snapshot.hasMore ?? (mergedNextCursor ? previousSnapshot.hasMore ?? false : false),
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

  if (mode === 'refresh' && previousSnapshot) {
    const refreshKeys = new Set(snapshot.items.map(getHistoryItemKey))
    const previousHeadKey = previousSnapshot.items[0]
      ? getHistoryItemKey(previousSnapshot.items[0])
      : null

    const forceRewrite = Boolean(previousHeadKey && !refreshKeys.has(previousHeadKey))

    if (!forceRewrite) {
      const seen = new Set<string>()
      const mergedItems = [] as typeof previousSnapshot.items

      for (const item of snapshot.items) {
        const key = getHistoryItemKey(item)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        mergedItems.push(item)
      }

      for (const item of previousSnapshot.items) {
        const key = getHistoryItemKey(item)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        mergedItems.push(item)
      }

      let trimmed = false
      let limitedItems = mergedItems
      if (mergedItems.length > MAX_HISTORY_ITEMS) {
        limitedItems = mergedItems.slice(0, MAX_HISTORY_ITEMS)
        trimmed = true
      }

      const hadOlderItems = previousSnapshot.items.some(item => !refreshKeys.has(getHistoryItemKey(item)))

      const previousCursor = previousSnapshot.nextCursor ?? null
      const incomingCursor = snapshot.nextCursor ?? null
      let mergedCursor: string | null = incomingCursor
      if (hadOlderItems && previousCursor) {
        mergedCursor = previousCursor
      } else if (!mergedCursor && previousCursor) {
        mergedCursor = previousCursor
      }

      if (trimmed) {
        mergedCursor = mergedCursor ?? previousCursor
      }

      const resolvedHead =
        snapshot.headCommit ??
        snapshot.items[0]?.fullHash ??
        previousSnapshot.headCommit ??
        entry.latestHead

      if (incomingCursor !== mergedCursor) {
        logger.debug('[gitHistoryAtom] Preserving advanced cursor after refresh', {
          repoPath,
          incomingCursor,
          mergedCursor,
          hadOlderItems,
          trimmed,
        })
      }

      if (trimmed) {
        logger.debug('[gitHistoryAtom] Trimmed merged git history snapshot', {
          repoPath,
          limit: MAX_HISTORY_ITEMS,
          total: mergedItems.length,
        })
      }

      const merged: HistoryProviderSnapshot = {
        ...previousSnapshot,
        ...snapshot,
        items: limitedItems,
        nextCursor: mergedCursor ?? undefined,
        hasMore:
          trimmed || hadOlderItems
            ? true
            : snapshot.hasMore ?? previousSnapshot.hasMore ?? false,
        currentRef: snapshot.currentRef ?? previousSnapshot.currentRef,
        currentRemoteRef:
          snapshot.currentRemoteRef ?? previousSnapshot.currentRemoteRef,
        currentBaseRef:
          snapshot.currentBaseRef ?? previousSnapshot.currentBaseRef,
        headCommit: resolvedHead ?? snapshot.headCommit,
        unchanged: snapshot.unchanged,
      }

      return {
        snapshot: merged,
        isLoading: false,
        isLoadingMore: false,
        error: null,
        loadMoreError: null,
        latestHead: resolvedHead ?? null,
      }
    }

    logger.info('[gitHistoryAtom] Refresh detected divergent head, resetting history snapshot', {
      repoPath,
      previousHead: previousHeadKey,
      incomingHead: snapshot.headCommit ?? snapshot.items[0]?.fullHash ?? null,
    })
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

async function runFetch(
  get: Getter,
  set: Setter,
  repoPath: string,
  mode: FetchMode,
  cursor?: string,
  sinceHeadOverride?: string | null,
) {
  if (!repoPath) {
    return
  }

  const existing = inflightRequests.get(repoPath)
  if (existing) {
    await existing
    if (mode === 'refresh') {
      await runFetch(get, set, repoPath, 'refresh', undefined, sinceHeadOverride)
    }
    return
  }

  updateEntry(get, set, repoPath, entry => {
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

  const currentEntries = get(gitHistoryEntriesAtom)
  const defaultSinceHead =
    mode === 'refresh'
      ? currentEntries.get(repoPath)?.latestHead ?? null
      : null
  const sinceHead =
    sinceHeadOverride === undefined ? defaultSinceHead : sinceHeadOverride

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

      updateEntry(get, set, repoPath, entry => buildUpdatedEntry(entry, snapshot, mode, repoPath))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (mode === 'append') {
        updateEntry(get, set, repoPath, entry => ({
          ...entry,
          isLoadingMore: false,
          loadMoreError: message,
        }))
      } else {
        updateEntry(get, set, repoPath, entry => ({
          ...entry,
          isLoading: false,
          error: message,
        }))
      }
      logger.error('[gitHistoryAtom] Failed to fetch git history', error)
    } finally {
      inflightRequests.delete(repoPath)
    }
  })()

  inflightRequests.set(repoPath, request)

  await request
}

export const gitHistoryEntryAtomFamily = atomFamily((repoPath: string | null | undefined) =>
  atom(get => {
    if (!repoPath) {
      return DEFAULT_ENTRY
    }
    const map = get(gitHistoryEntriesAtom)
    return map.get(repoPath) ?? DEFAULT_ENTRY
  }),
)

export const gitHistoryFilterAtomFamily = atomFamily((repoPath: string | null | undefined) =>
  atom(
    get => {
      if (!repoPath) {
        return DEFAULT_FILTER
      }
      const map = get(gitHistoryFiltersAtom)
      return map.get(repoPath) ?? DEFAULT_FILTER
    },
    (get, set, update: GitHistoryFilter | ((prev: GitHistoryFilter) => GitHistoryFilter)) => {
      if (!repoPath) {
        return
      }

      const currentMap = get(gitHistoryFiltersAtom)
      const previous = currentMap.get(repoPath) ?? DEFAULT_FILTER
      const nextValue = typeof update === 'function' ? update(previous) : update
      const normalized: GitHistoryFilter = {
        searchText: nextValue.searchText ?? '',
        author: nextValue.author ?? null,
      }

      const updated = new Map(currentMap)
      updated.set(repoPath, normalized)
      set(gitHistoryFiltersAtom, updated)
    },
  ),
)

export function applyGitHistoryFilters(items: HistoryItem[], filter: GitHistoryFilter): HistoryItem[] {
  if (!items.length) {
    return items
  }

  const search = filter.searchText.trim()
  const author = filter.author?.trim().toLowerCase() ?? ''

  if (!search && !author) {
    return items
  }

  return items.filter(item => {
    const itemAuthor = item.author.toLowerCase()

    if (author && !itemAuthor.includes(author)) {
      return false
    }

    if (!search) {
      return true
    }

    const identifier = item.fullHash ?? item.id
    return fuzzyMatch(item.subject, search) || fuzzyMatch(identifier, search) || fuzzyMatch(item.author, search)
  })
}

export const filteredGitHistoryAtomFamily = atomFamily((repoPath: string | null | undefined) =>
  atom(get => {
    if (!repoPath) {
      return [] as HistoryItem[]
    }

    const entry = get(gitHistoryEntryAtomFamily(repoPath))
    const filter = get(gitHistoryFilterAtomFamily(repoPath))
    const items = entry.snapshot?.items ?? []
    return applyGitHistoryFilters(items, filter)
  }),
)

export const ensureGitHistoryLoadedActionAtom = atom(
  null,
  async (get, set, repoPath: string | null | undefined) => {
    if (!repoPath) {
      return
    }

    const entry = get(gitHistoryEntryAtomFamily(repoPath))
    if (entry.snapshot || entry.isLoading) {
      return
    }

    await runFetch(get, set, repoPath, 'initial')
  },
)

export const loadMoreGitHistoryActionAtom = atom(
  null,
  async (get, set, payload: { repoPath: string | null | undefined; cursor?: string | null }) => {
    const repoPath = payload.repoPath
    const cursor = payload.cursor ?? undefined

    if (!repoPath || !cursor) {
      return
    }

    await runFetch(get, set, repoPath, 'append', cursor)
  },
)

type RefreshGitHistoryActionInput =
  | string
  | null
  | undefined
  | { repoPath: string | null | undefined; sinceHeadOverride?: string | null }

export const refreshGitHistoryActionAtom = atom(
  null,
  async (get, set, payload: RefreshGitHistoryActionInput) => {
    const repoPath =
      typeof payload === 'string' || payload === null || payload === undefined
        ? payload
        : payload.repoPath
    const sinceHeadOverride =
      typeof payload === 'string' || payload === null || payload === undefined
        ? undefined
        : payload.sinceHeadOverride

    if (!repoPath) {
      return
    }

    await runFetch(get, set, repoPath, 'refresh', undefined, sinceHeadOverride)
  },
)

function noopPromise(): Promise<void> {
  return Promise.resolve()
}

export function useGitHistory(repoPath: string | null | undefined) {
  const normalized = repoPath ?? null
  const entry = useAtomValue(gitHistoryEntryAtomFamily(normalized))
  const filterValue = useAtomValue(gitHistoryFilterAtomFamily(normalized))
  const filteredItems = useAtomValue(filteredGitHistoryAtomFamily(normalized))
  const ensureLoadedAction = useSetAtom(ensureGitHistoryLoadedActionAtom)
  const loadMoreAction = useSetAtom(loadMoreGitHistoryActionAtom)
  const refreshAction = useSetAtom(refreshGitHistoryActionAtom)
  const setFilterAction = useSetAtom(gitHistoryFilterAtomFamily(normalized))

  const ensureLoadedForRepo = useCallback(() => {
    if (!normalized) {
      return noopPromise()
    }
    return ensureLoadedAction(normalized)
  }, [ensureLoadedAction, normalized])

  const loadMoreForRepo = useCallback(
    (cursor?: string | null) => {
      if (!normalized || !cursor) {
        return noopPromise()
      }
      return loadMoreAction({ repoPath: normalized, cursor })
    },
    [loadMoreAction, normalized],
  )

  const refreshForRepo = useCallback(
    (options?: GitHistoryRefreshOptions) => {
      if (!normalized) {
        return noopPromise()
      }

      if (!options) {
        return refreshAction(normalized)
      }

      return refreshAction({ repoPath: normalized, ...options })
    },
    [refreshAction, normalized],
  )

  const setFilterForRepo = useCallback(
    (next: GitHistoryFilter | ((prev: GitHistoryFilter) => GitHistoryFilter)) => {
      if (!normalized) {
        return
      }
      setFilterAction(next)
    },
    [setFilterAction, normalized],
  )

  return useMemo(() => {
    if (!normalized) {
      return {
        snapshot: null,
        isLoading: false,
        isLoadingMore: false,
        error: null,
        loadMoreError: null,
        latestHead: null,
        filteredItems: [] as HistoryItem[],
        filter: DEFAULT_FILTER,
        ensureLoaded: noopPromise,
        loadMore: noopPromise,
        refresh: noopPromise,
        setFilter: () => {},
      }
    }

    return {
      snapshot: entry.snapshot,
      isLoading: entry.isLoading,
      isLoadingMore: entry.isLoadingMore,
      error: entry.error,
      loadMoreError: entry.loadMoreError,
      latestHead: entry.latestHead,
      filteredItems,
      filter: filterValue,
      ensureLoaded: ensureLoadedForRepo,
      loadMore: loadMoreForRepo,
      refresh: refreshForRepo,
      setFilter: setFilterForRepo,
    }
  }, [entry, filteredItems, filterValue, normalized, ensureLoadedForRepo, loadMoreForRepo, refreshForRepo, setFilterForRepo])
}
