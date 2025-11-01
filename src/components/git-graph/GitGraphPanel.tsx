import { useState, useEffect, useMemo, memo, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { HistoryList } from './HistoryList'
import { toViewModel } from './graphLayout'
import type {
  CommitDetailState,
  CommitFileChange,
  HistoryItem,
  HistoryItemViewModel,
  HistoryProviderSnapshot,
} from './types'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { useToast } from '../../common/toast/ToastProvider'
import { writeClipboard } from '../../utils/clipboard'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { EventPayloadMap } from '../../common/events'
import { useGitHistory } from '../../store/atoms/gitHistory'
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

interface GitGraphPanelProps {
  onOpenCommitDiff?: (payload: {
    repoPath: string
    commit: HistoryItem
    files: CommitFileChange[]
    initialFilePath?: string
  }) => void
  repoPath?: string | null
  sessionName?: string | null
}

type RefreshRequest = {
  head: string
  forced: boolean
  sinceHeadOverride: string | null | undefined
}

type PendingHeadInfo = {
  forced: boolean
  sinceHeadOverride: string | null | undefined
}

type PendingHeadBucket = Map<string, PendingHeadInfo>

export const GitGraphPanel = memo(({ onOpenCommitDiff, repoPath: repoPathOverride, sessionName }: GitGraphPanelProps = {}) => {
  const projectPath = useAtomValue(projectPathAtom)
  const repoPath = repoPathOverride ?? projectPath
  const { pushToast } = useToast()
  const {
    snapshot,
    isLoading,
    error,
    isLoadingMore,
    loadMoreError,
    latestHead,
    ensureLoaded,
    loadMore: loadMoreHistory,
    refresh: refreshHistory,
  } = useGitHistory(repoPath)
  const repoPathRef = useRef<string | null>(repoPath ?? null)
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commit: HistoryItem } | null>(null)
  const [commitDetails, setCommitDetails] = useState<Record<string, CommitDetailState>>({})
  const [pendingLoadMore, setPendingLoadMore] = useState(false)
  const commitDetailsRef = useRef<Record<string, CommitDetailState>>({})
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const latestHeadRef = useRef<string | null>(null)
  const previousHeadRef = useRef<string | null>(null)
  const hasLoadedRef = useRef(false)
  const refreshProcessingRef = useRef(false)
  const pendingRefreshHeadsRef = useRef<RefreshRequest[]>([])
  const activeRefreshHeadRef = useRef<string | null>(null)
  const lastManualRefreshRef = useRef(0)
  const pendingHeadsRef = useRef<Map<string, PendingHeadBucket>>(new Map())
  const unsubscribeRef = useRef<(() => void | Promise<void>) | null>(null)
  const snapshotRef = useRef<HistoryProviderSnapshot | null>(null)
  const lastLoadMoreErrorRef = useRef<string | null>(null)

  const historyItems = useMemo(() => {
    return snapshot ? toViewModel(snapshot) : []
  }, [snapshot])

  const hasSnapshot = Boolean(snapshot)
  const hasMore = snapshot?.hasMore ?? false
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || pendingLoadMore) {
      return
    }

    const activeSnapshot = snapshotRef.current ?? snapshot ?? null
    const cursor = activeSnapshot?.nextCursor
    if (!cursor) {
      return
    }

    setPendingLoadMore(true)

    try {
      await loadMoreHistory(cursor)
    } finally {
      setPendingLoadMore(false)
    }

    const updatedCursor = snapshotRef.current?.nextCursor
    if (updatedCursor && updatedCursor === cursor) {
      logger.debug('[GitGraphPanel] Load more cursor unchanged after fetch', {
        repoPath,
        cursor,
      })
    }
  }, [isLoadingMore, pendingLoadMore, loadMoreHistory, repoPath, snapshot])

  const handleContextMenu = useCallback((event: React.MouseEvent, commit: HistoryItem) => {
    event.preventDefault()
    event.stopPropagation()
    if (commit.id !== selectedCommitId) {
      setSelectedCommitId(commit.id)
    }
    setContextMenu({ x: event.clientX, y: event.clientY, commit })
  }, [selectedCommitId])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleCopyCommitId = useCallback(async () => {
    if (!contextMenu) return
    const success = await writeClipboard(contextMenu.commit.id)
    if (success) {
      pushToast({ tone: 'success', title: 'Copied commit ID', description: contextMenu.commit.id.substring(0, 7) })
    } else {
      pushToast({ tone: 'error', title: 'Copy failed', description: 'Unable to access clipboard' })
    }
    setContextMenu(null)
  }, [contextMenu, pushToast])

  const handleCopyCommitMessage = useCallback(async () => {
    if (!contextMenu) return
    const success = await writeClipboard(contextMenu.commit.subject)
    if (success) {
      pushToast({ tone: 'success', title: 'Copied commit message' })
    } else {
      pushToast({ tone: 'error', title: 'Copy failed', description: 'Unable to access clipboard' })
    }
    setContextMenu(null)
  }, [contextMenu, pushToast])

  const handlePanelInteraction = useCallback((event: React.MouseEvent) => {
    if (event.defaultPrevented) {
      return
    }

    if (contextMenu) {
      return
    }

    if (event.button !== 0) {
      return
    }

    if (event.target !== event.currentTarget) {
      return
    }

    if (contextMenuRef.current && event.target instanceof Node) {
      if (contextMenuRef.current.contains(event.target)) {
        return
      }
    }

    if (!repoPath || !hasLoadedRef.current) {
      logger.debug('[GitGraphPanel] Panel interaction ignored', { repoPath, hasLoaded: hasLoadedRef.current })
      return
    }

    const now = Date.now()
    if (now - lastManualRefreshRef.current < 1200) {
      logger.debug('[GitGraphPanel] Panel interaction throttled', { repoPath })
      return
    }

    lastManualRefreshRef.current = now
    logger.debug('[GitGraphPanel] Panel interaction refresh', { repoPath })
    void refreshHistory()
  }, [contextMenu, repoPath, refreshHistory])

  const handleOpenCommitDiffInternal = useCallback(async (commit: HistoryItem, filePath?: string) => {
    if (!onOpenCommitDiff || !repoPath) {
      return
    }

    const commitHash = commit.fullHash ?? commit.id
    let files = commitDetailsRef.current[commit.id]?.files ?? null

    if (!files || files.length === 0) {
      try {
        files = await invoke<CommitFileChange[]>(TauriCommands.GetGitGraphCommitFiles, {
          repoPath,
          commitHash,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        pushToast({ tone: 'error', title: 'Failed to open diff', description: message })
        return
      }
    }

    if (!files || files.length === 0) {
      pushToast({ tone: 'info', title: 'No file changes', description: 'This commit has no files to diff.' })
      return
    }

    onOpenCommitDiff({ repoPath, commit, files, initialFilePath: filePath })
  }, [onOpenCommitDiff, repoPath, pushToast])

  useEffect(() => {
    commitDetailsRef.current = commitDetails
  }, [commitDetails])

  useEffect(() => {
    repoPathRef.current = repoPath ?? null
  }, [repoPath])

  useEffect(() => {
    snapshotRef.current = snapshot ?? null
  }, [snapshot])

  useEffect(() => {
    if (!isLoadingMore) {
      setPendingLoadMore(false)
    }
  }, [isLoadingMore])

  useEffect(() => {
    previousHeadRef.current = latestHeadRef.current
    latestHeadRef.current = latestHead ?? null
  }, [latestHead])

  useEffect(() => {
    if (!loadMoreError) {
      lastLoadMoreErrorRef.current = null
      return
    }

    if (lastLoadMoreErrorRef.current === loadMoreError) {
      return
    }

    lastLoadMoreErrorRef.current = loadMoreError
    pushToast({
      tone: 'error',
      title: 'Failed to load more commits',
      description: loadMoreError,
    })
  }, [loadMoreError, pushToast])

  const headsMatch = useCallback((a?: string | null, b?: string | null) => {
    if (!a || !b) {
      return false
    }
    const len = Math.min(a.length, b.length)
    return a.slice(0, len) === b.slice(0, len)
  }, [])

  const processRefreshQueue = useCallback(
    async () => {
      if (refreshProcessingRef.current || !repoPath) {
        return
      }

      refreshProcessingRef.current = true

      try {
        while (pendingRefreshHeadsRef.current.length > 0) {
          const request = pendingRefreshHeadsRef.current.shift()
          if (!request) {
            continue
          }

          activeRefreshHeadRef.current = request.head
          const options = request.sinceHeadOverride === undefined
            ? undefined
            : { sinceHeadOverride: request.sinceHeadOverride }
          await refreshHistory(options)

          if (request.forced && !headsMatch(latestHeadRef.current, request.head)) {
            logger.debug('[GitGraphPanel] Forced refresh did not reach target head, retrying full refresh', {
              repoPath,
              requestedHead: request.head,
              latestKnownHead: latestHeadRef.current,
            })
            await refreshHistory()
          }

          activeRefreshHeadRef.current = null
        }
      } finally {
        activeRefreshHeadRef.current = null
        refreshProcessingRef.current = false
        if (pendingRefreshHeadsRef.current.length > 0) {
          void processRefreshQueue()
        }
      }
    },
    [repoPath, refreshHistory, headsMatch]
  )

  const enqueueRefreshHead = useCallback(
    (head: string, options?: { force?: boolean; sinceHeadOverride?: string | null }) => {
      if (!repoPath) {
        return
      }

      const forced = Boolean(options?.force)
      const sinceHeadOverride = options?.sinceHeadOverride

      if (!forced && headsMatch(latestHeadRef.current, head)) {
        logger.debug('[GitGraphPanel] enqueue skipped (head matches)', { repoPath, head })
        return
      }

      if (!forced && activeRefreshHeadRef.current === head) {
        return
      }

      const queue = pendingRefreshHeadsRef.current
      const existingIndex = queue.findIndex(request => request.head === head)
      if (existingIndex >= 0) {
        const existing = queue[existingIndex]
        const nextForced = existing.forced || forced
        const nextSinceHeadOverride =
          sinceHeadOverride === undefined ? existing.sinceHeadOverride : sinceHeadOverride
        queue[existingIndex] = {
          head,
          forced: nextForced,
          sinceHeadOverride: nextSinceHeadOverride,
        }
      } else {
        queue.push({
          head,
          forced,
          sinceHeadOverride,
        })
      }
      void processRefreshQueue()
    },
    [repoPath, processRefreshQueue, headsMatch]
  )

  const flushPendingHeads = useCallback(
    (session: string, reason: string) => {
      const pending = pendingHeadsRef.current.get(session)
      if (!pending || pending.size === 0) {
        return
      }

      const queued = Array.from(pending.entries()).map(([head, info]) => ({ head, ...info }))
      pendingHeadsRef.current.delete(session)
      logger.debug('[GitGraphPanel] Flushing queued heads', {
        repoPath,
        reason,
        session,
        heads: queued.map(entry => entry.head),
        forced: queued.filter(entry => entry.forced).map(entry => entry.head),
      })

      queued.forEach(({ head, forced, sinceHeadOverride }) => {
        if (!forced && headsMatch(latestHeadRef.current, head)) {
          logger.debug('[GitGraphPanel] Flush skipped head (matches latest)', { repoPath, head, reason, session })
          return
        }

        const snapshotHead = snapshotRef.current?.headCommit ?? null
        const firstItem = snapshotRef.current?.items?.[0]
        const resolvedSinceHeadOverride = forced
          ? sinceHeadOverride ?? snapshotHead ?? firstItem?.fullHash ?? firstItem?.id ?? latestHeadRef.current ?? previousHeadRef.current ?? null
          : undefined

        enqueueRefreshHead(head, { force: forced, sinceHeadOverride: resolvedSinceHeadOverride })
      })
    },
    [enqueueRefreshHead, headsMatch, repoPath]
  )

  const queuePendingHead = useCallback(
    (session: string, head: string, options?: { force?: boolean; sinceHeadOverride?: string | null }) => {
      if (!head) {
        return
      }
      let bucket = pendingHeadsRef.current.get(session)
      if (!bucket) {
        bucket = new Map<string, PendingHeadInfo>()
        pendingHeadsRef.current.set(session, bucket)
      }
      const forced = Boolean(options?.force)
      const existing = bucket.get(head)
      const nextForced = (existing?.forced ?? false) || forced
      const suppliedOverride = options?.sinceHeadOverride
      const fallbackOverride = suppliedOverride ?? existing?.sinceHeadOverride ?? latestHeadRef.current ?? snapshotRef.current?.headCommit ?? previousHeadRef.current ?? null
      bucket.set(head, {
        forced: nextForced,
        sinceHeadOverride: nextForced ? fallbackOverride : existing?.sinceHeadOverride ?? null,
      })
      logger.debug('[GitGraphPanel] File change queued (not ready)', {
        repoPath,
        session,
        head,
        pendingCount: bucket.size,
        forced: nextForced,
        sinceHeadOverride: fallbackOverride,
      })
    },
    [repoPath]
  )

  useEffect(() => {
    refreshProcessingRef.current = false
    pendingRefreshHeadsRef.current = []
    activeRefreshHeadRef.current = null
    hasLoadedRef.current = false
    latestHeadRef.current = null
    previousHeadRef.current = null
    snapshotRef.current = null

    setSelectedCommitId(null)
    setContextMenu(null)
    setCommitDetails({})
    commitDetailsRef.current = {}

    if (!repoPath) {
      return
    }

    let cancelled = false
    const sessionKey = sessionName ?? ORCHESTRATOR_SESSION_NAME

    const bootstrap = async () => {
      try {
        await ensureLoaded()
        if (cancelled) {
          return
        }
        hasLoadedRef.current = true
        flushPendingHeads(sessionKey, 'after-ensureLoaded')
        logger.debug('[GitGraphPanel] Bootstrap refresh start', { repoPath })
        await refreshHistory()
        logger.debug('[GitGraphPanel] Bootstrap refresh complete', { repoPath })
        flushPendingHeads(sessionKey, 'after-bootstrap-refresh')
      } catch (error) {
        logger.warn('[GitGraphPanel] Failed to bootstrap history load', error)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [repoPath, ensureLoaded, refreshHistory, flushPendingHeads, sessionName])

  useEffect(() => {
    if (snapshot) {
      hasLoadedRef.current = true
      const sessionKey = sessionName ?? ORCHESTRATOR_SESSION_NAME
      flushPendingHeads(sessionKey, 'on-snapshot')
    }
  }, [snapshot, flushPendingHeads, sessionName])

  const handleFileChanges = useCallback(
    (payload: EventPayloadMap[SchaltEvent.FileChanges]) => {
      const targetSession = sessionName ?? ORCHESTRATOR_SESSION_NAME
      const eventSession = payload?.session_name
      const nextHead = payload?.branch_info?.head_commit?.trim()

      const sessionKey = eventSession ?? ORCHESTRATOR_SESSION_NAME

      if (eventSession !== targetSession) {
        logger.debug('[GitGraphPanel] File change ignored (session mismatch)', {
          repoPath,
          targetSession,
          eventSession,
        })
        if (!hasLoadedRef.current && nextHead) {
          queuePendingHead(sessionKey, nextHead, {
            force: true,
            sinceHeadOverride: snapshotRef.current?.headCommit ?? latestHeadRef.current ?? previousHeadRef.current ?? null,
          })
        }
        return
      }

      if (!repoPath) {
        logger.debug('[GitGraphPanel] File change ignored (no repo path)', { eventSession })
        return
      }

      if (!hasLoadedRef.current) {
        if (nextHead) {
          queuePendingHead(sessionKey, nextHead, {
            force: true,
            sinceHeadOverride: snapshotRef.current?.headCommit ?? latestHeadRef.current ?? previousHeadRef.current ?? null,
          })
        } else {
          logger.debug('[GitGraphPanel] File change ignored (not ready)', { repoPath })
        }
        return
      }

      if (!nextHead) {
        logger.debug('[GitGraphPanel] File change ignored (no head)', { repoPath })
        return
      }

      if (headsMatch(latestHeadRef.current, nextHead)) {
        logger.debug('[GitGraphPanel] File change ignored (head matches)', {
          repoPath,
          head: nextHead,
        })
        return
      }

      logger.debug('[GitGraphPanel] File change enqueued refresh', {
        repoPath,
        head: nextHead,
        targetSession,
      })
      enqueueRefreshHead(nextHead)
    },
    [repoPath, enqueueRefreshHead, sessionName, headsMatch, queuePendingHead]
  )

  useEffect(() => {
    let isMounted = true

    const attach = async () => {
      try {
        const unlistenFileChanges = await listenEvent(SchaltEvent.FileChanges, handleFileChanges)
        if (!isMounted) {
          try {
            await Promise.resolve(unlistenFileChanges())
          } catch (err) {
            logger.debug('[GitGraphPanel] Ignored unlisten error during mount race', err)
          }
          return
        }
        unsubscribeRef.current = unlistenFileChanges
      } catch (err) {
        logger.warn('[GitGraphPanel] Failed to subscribe to file change events', err)
      }
    }

    attach()

    return () => {
      isMounted = false
      const unlistenFn = unsubscribeRef.current
      unsubscribeRef.current = null
      if (unlistenFn) {
        void (async () => {
          try {
            await Promise.resolve(unlistenFn())
          } catch (err) {
            logger.debug('[GitGraphPanel] Ignored unlisten error during cleanup', err)
          }
        })()
      }
    }
  }, [handleFileChanges])

  const handleToggleCommitDetails = useCallback((viewModel: HistoryItemViewModel) => {
    if (!repoPath) {
      return
    }

    const commitId = viewModel.historyItem.id
    const commitHash = viewModel.historyItem.fullHash ?? viewModel.historyItem.id
    const current = commitDetailsRef.current[commitId]
    const willExpand = !(current?.isExpanded ?? false)

    logger.debug('[GitGraphPanel] toggle commit details', {
      commitId,
      willExpand,
      hasExistingState: Boolean(current),
    })

    if (!willExpand) {
      setCommitDetails(prev => ({
        ...prev,
        [commitId]: current
          ? { ...current, isExpanded: false, isLoading: false }
          : { isExpanded: false, isLoading: false, files: null, error: null }
      }))
      return
    }

    const shouldFetch = !current?.files || Boolean(current?.error)

    setCommitDetails(prev => ({
      ...prev,
      [commitId]: {
        isExpanded: true,
        isLoading: shouldFetch,
        files: current?.files ?? null,
        error: null,
      },
    }))

    if (!shouldFetch) {
      logger.debug('[GitGraphPanel] skipping fetch for commit details', { commitId })
      return
    }

    logger.debug('[GitGraphPanel] fetching commit files', { commitId })
    invoke<CommitFileChange[]>(TauriCommands.GetGitGraphCommitFiles, {
      repoPath,
      commitHash,
    })
      .then(files => {
        if (repoPathRef.current !== repoPath) {
          return
        }
        setCommitDetails(prev => ({
          ...prev,
          [commitId]: {
            isExpanded: true,
            isLoading: false,
            files,
            error: null,
          },
        }))
      })
      .catch(err => {
        if (repoPathRef.current !== repoPath) {
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[GitGraphPanel] Failed to load commit files', err)
        setCommitDetails(prev => ({
          ...prev,
          [commitId]: {
            isExpanded: true,
            isLoading: false,
            files: prev[commitId]?.files ?? null,
            error: message,
          },
        }))
      })
  }, [repoPath])

  useEffect(() => {
    if (!contextMenu) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu])

  if (!repoPath) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No repository selected
      </div>
    )
  }

  if (!hasSnapshot) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-slate-400 text-xs">
          Loading git history...
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-red-400 text-xs p-4">
          <div className="mb-2">Failed to load git history</div>
          <div className="text-slate-500 text-[10px] max-w-md text-center break-words">{error}</div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No git history available
      </div>
    )
  }

  if (historyItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No git history available
      </div>
    )
  }

  return (
    <div
      className="h-full flex flex-col bg-panel relative"
      data-testid="git-history-panel"
      onMouseDown={handlePanelInteraction}
    >
      <HistoryList
        items={historyItems}
        selectedCommitId={selectedCommitId}
        onSelectCommit={setSelectedCommitId}
        onContextMenu={handleContextMenu}
        commitDetails={commitDetails}
        onToggleCommitDetails={handleToggleCommitDetails}
        onOpenCommitDiff={(viewModel, filePath) => handleOpenCommitDiffInternal(viewModel.historyItem, filePath)}
      />
      {hasMore && (
        <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-400 flex items-center justify-between">
          {loadMoreError ? (
            <span className="text-red-400" title={loadMoreError}>
              Failed to load more commits
            </span>
          ) : (
            <span>More commits available</span>
          )}
          <button
            onClick={() => {
              void handleLoadMore()
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded text-slate-200"
            disabled={isLoadingMore || pendingLoadMore}
          >
            {isLoadingMore || pendingLoadMore ? 'Loading…' : 'Load more commits'}
          </button>
        </div>
      )}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={event => {
              if (event.button !== 0) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              handleCloseContextMenu()
            }}
            onContextMenu={event => {
              if (event.defaultPrevented) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              handleCloseContextMenu()
            }}
          />
          <div
            className="fixed z-50 py-0.5 rounded-md shadow-lg"
            ref={contextMenuRef}
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              backgroundColor: theme.colors.background.elevated,
              border: `1px solid ${theme.colors.border.subtle}`,
              minWidth: '160px'
            }}
          >
            {contextMenu && onOpenCommitDiff && (
              <button
                type="button"
                className="w-full px-3 py-1 text-left text-xs hover:bg-[color:var(--hover-bg)] transition-colors"
                style={{ '--hover-bg': theme.colors.background.secondary } as React.CSSProperties}
                onClick={() => {
                  void handleOpenCommitDiffInternal(contextMenu.commit)
                  setContextMenu(null)
                }}
              >
                Open diff
              </button>
            )}
            <button
              type="button"
              className="w-full px-3 py-1 text-left text-xs hover:bg-[color:var(--hover-bg)] transition-colors"
              style={{ '--hover-bg': theme.colors.background.secondary } as React.CSSProperties}
              onClick={handleCopyCommitId}
            >
              Copy commit ID
            </button>
            <button
              type="button"
              className="w-full px-3 py-1 text-left text-xs hover:bg-[color:var(--hover-bg)] transition-colors"
              style={{ '--hover-bg': theme.colors.background.secondary } as React.CSSProperties}
              onClick={handleCopyCommitMessage}
            >
              Copy commit message
            </button>
          </div>
        </>
      )}
    </div>
  )
})

GitGraphPanel.displayName = 'GitGraphPanel'
