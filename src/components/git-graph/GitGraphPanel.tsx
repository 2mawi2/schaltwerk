import { useState, useEffect, useMemo, memo, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { useProject } from '../../contexts/ProjectContext'
import { HistoryList } from './HistoryList'
import { toViewModel } from './graphLayout'
import type { CommitDetailState, CommitFileChange, HistoryItem, HistoryItemViewModel } from './types'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { useToast } from '../../common/toast/ToastProvider'
import { writeClipboard } from '../../utils/clipboard'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { EventPayloadMap } from '../../common/events'
import { useGitHistory } from '../../contexts/GitHistoryContext'

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

export const GitGraphPanel = memo(({ onOpenCommitDiff, repoPath: repoPathOverride, sessionName }: GitGraphPanelProps = {}) => {
  const { projectPath } = useProject()
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
  const commitDetailsRef = useRef<Record<string, CommitDetailState>>({})
  const latestHeadRef = useRef<string | null>(null)
  const hasLoadedRef = useRef(false)
  const refreshProcessingRef = useRef(false)
  const pendingRefreshHeadsRef = useRef<string[]>([])
  const activeRefreshHeadRef = useRef<string | null>(null)

  useEffect(() => {
    refreshProcessingRef.current = false
    pendingRefreshHeadsRef.current = []
    activeRefreshHeadRef.current = null
    hasLoadedRef.current = false
    latestHeadRef.current = null

    setSelectedCommitId(null)
    setContextMenu(null)
    setCommitDetails({})
    commitDetailsRef.current = {}

    if (!repoPath) {
      return
    }

    void ensureLoaded()
  }, [repoPath, ensureLoaded])

  const historyItems = useMemo(() => {
    return snapshot ? toViewModel(snapshot) : []
  }, [snapshot])

  const hasMore = snapshot?.hasMore ?? false
  const nextCursor = snapshot?.nextCursor

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || isLoadingMore) {
      return
    }
    void loadMoreHistory(nextCursor)
  }, [nextCursor, isLoadingMore, loadMoreHistory])

  const handleContextMenu = useCallback((event: React.MouseEvent, commit: HistoryItem) => {
    event.preventDefault()
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
    hasLoadedRef.current = Boolean(snapshot)
  }, [snapshot])

  useEffect(() => {
    latestHeadRef.current = latestHead ?? null
  }, [latestHead])

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
          const head = pendingRefreshHeadsRef.current.shift()
          if (!head) {
            continue
          }

          activeRefreshHeadRef.current = head
          await refreshHistory()
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
    [repoPath, refreshHistory]
  )

  const enqueueRefreshHead = useCallback(
    (head: string) => {
      if (!repoPath) {
        return
      }

      if (headsMatch(latestHeadRef.current, head)) {
        return
      }

      if (activeRefreshHeadRef.current === head) {
        return
      }

      const queue = pendingRefreshHeadsRef.current
      if (!queue.includes(head)) {
        queue.push(head)
      }
      void processRefreshQueue()
    },
    [repoPath, processRefreshQueue, headsMatch]
  )

  const handleFileChanges = useCallback(
    (payload: EventPayloadMap[SchaltEvent.FileChanges]) => {
      if (!repoPath || !hasLoadedRef.current) {
        return
      }

      if (sessionName && payload?.session_name !== sessionName) {
        return
      }

      const nextHead = payload?.branch_info?.head_commit?.trim()
      if (!nextHead) {
        return
      }

      if (headsMatch(latestHeadRef.current, nextHead)) {
        return
      }

      enqueueRefreshHead(nextHead)
    },
    [repoPath, enqueueRefreshHead, sessionName, headsMatch]
  )

  useEffect(() => {
    let isMounted = true
    let unlisten: (() => void) | null = null

    const attach = async () => {
      try {
        const unlistenFileChanges = await listenEvent(SchaltEvent.FileChanges, handleFileChanges)
        if (!isMounted) {
          try {
            await unlistenFileChanges()
          } catch (err) {
            logger.warn('[GitGraphPanel] Failed to unsubscribe from file change events', err)
          }
          return
        }
        unlisten = unlistenFileChanges
      } catch (err) {
        logger.warn('[GitGraphPanel] Failed to subscribe to file change events', err)
      }
    }

    attach()

    return () => {
      isMounted = false
      if (unlisten) {
        const unlistenFn = unlisten
        unlisten = null
        void (async () => {
          try {
            await unlistenFn()
          } catch (err) {
            logger.warn('[GitGraphPanel] Failed to unsubscribe from file change events', err)
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

  if (historyItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No git history available
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel relative">
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
            onClick={handleLoadMore}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded text-slate-200"
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Loading…' : 'Load more commits'}
          </button>
        </div>
      )}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={handleCloseContextMenu}
            onContextMenu={event => {
              event.preventDefault()
              handleCloseContextMenu()
            }}
          />
          <div
            className="fixed z-50 py-0.5 rounded-md shadow-lg"
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
