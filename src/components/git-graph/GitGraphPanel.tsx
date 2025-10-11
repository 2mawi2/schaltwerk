import { useState, useEffect, useMemo, memo, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { useProject } from '../../contexts/ProjectContext'
import { HistoryList } from './HistoryList'
import { toViewModel } from './graphLayout'
import type { CommitDetailState, CommitFileChange, HistoryProviderSnapshot, HistoryItem, HistoryItemViewModel } from './types'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { useToast } from '../../common/toast/ToastProvider'
import { writeClipboard } from '../../utils/clipboard'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { EventPayloadMap } from '../../common/events'

interface GitGraphPanelProps {
  onOpenCommitDiff?: (payload: {
    repoPath: string
    commit: HistoryItem
    files: CommitFileChange[]
    initialFilePath?: string
  }) => void
}

const HISTORY_PAGE_SIZE = 400

export const GitGraphPanel = memo(({ onOpenCommitDiff }: GitGraphPanelProps = {}) => {
  const { projectPath } = useProject()
  const { pushToast } = useToast()
  const [snapshot, setSnapshot] = useState<HistoryProviderSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const activeProjectRef = useRef<string | null>(projectPath ?? null)
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
    activeProjectRef.current = projectPath ?? null
  }, [projectPath])

  const mergeSnapshot = useCallback(
    (incoming: HistoryProviderSnapshot, append: boolean) => {
      setSnapshot(prev => {
        if (append && prev) {
          const existingKeys = new Set(prev.items.map(item => item.fullHash ?? item.id))
          const deduped = incoming.items.filter(item => {
            const key = item.fullHash ?? item.id
            if (existingKeys.has(key)) {
              return false
            }
            existingKeys.add(key)
            return true
          })

          return {
            ...prev,
            items: [...prev.items, ...deduped],
            currentRef: incoming.currentRef ?? prev.currentRef,
            currentRemoteRef: incoming.currentRemoteRef ?? prev.currentRemoteRef,
            currentBaseRef: incoming.currentBaseRef ?? prev.currentBaseRef,
            nextCursor: incoming.nextCursor,
            hasMore: incoming.hasMore,
          }
        }

        return {
          ...incoming,
        }
      })
    },
    []
  )

  const loadHistory = useCallback(
    async (options?: { cursor?: string; mode?: 'initial' | 'append' | 'refresh' }) => {
      if (!projectPath) {
        return
      }

      const cursor = options?.cursor
      const mode = options?.mode ?? (cursor ? 'append' : 'initial')
      const append = mode === 'append'
      const refresh = mode === 'refresh'
      if (append) {
        setIsLoadingMore(true)
        setLoadMoreError(null)
      } else if (refresh) {
        setLoadMoreError(null)
      } else {
        setIsLoading(true)
        setError(null)
        setLoadMoreError(null)
      }

      try {
        const result = await invoke<HistoryProviderSnapshot>(TauriCommands.GetGitGraphHistory, {
          repoPath: projectPath,
          limit: HISTORY_PAGE_SIZE,
          cursor,
        })

        logger.debug('[GitGraphPanel] Received history page', {
          itemCount: result.items.length,
          append,
          hasMore: result.hasMore,
          mode,
          nextCursor: result.nextCursor,
        })

        if (activeProjectRef.current !== projectPath) {
          return
        }

        mergeSnapshot(result, append)

        if (!append) {
          const topItem = result.items[0]
          const fullHash = topItem?.fullHash ?? null
          const shortFromFull = fullHash ? fullHash.slice(0, 7) : null
          const topHead = shortFromFull ?? topItem?.id ?? null
          latestHeadRef.current = topHead ?? null
          hasLoadedRef.current = true
        }
      } catch (err) {
        if (activeProjectRef.current !== projectPath) {
          return
        }
        const errorMsg = err instanceof Error ? err.message : String(err)
        if (append) {
          logger.error('[GitGraphPanel] Failed to fetch additional git history', err)
          setLoadMoreError(errorMsg)
        } else if (refresh) {
          logger.warn('[GitGraphPanel] Failed to refresh git history', err)
        } else {
          logger.error('[GitGraphPanel] Failed to fetch git history', err)
          setError(errorMsg)
        }
      } finally {
        if (activeProjectRef.current === projectPath) {
          if (append) {
            setIsLoadingMore(false)
          } else if (!refresh) {
            setIsLoading(false)
          }
        }
      }
    },
    [projectPath, mergeSnapshot]
  )

  useEffect(() => {
    refreshProcessingRef.current = false
    pendingRefreshHeadsRef.current = []
    activeRefreshHeadRef.current = null
    hasLoadedRef.current = false
    latestHeadRef.current = null

    if (!projectPath) {
      setSnapshot(null)
      setIsLoading(false)
      setIsLoadingMore(false)
      setError(null)
      setLoadMoreError(null)
      setSelectedCommitId(null)
      setContextMenu(null)
      return
    }

    setSnapshot(null)
    setLoadMoreError(null)
    setSelectedCommitId(null)
    setContextMenu(null)
    setCommitDetails({})
    commitDetailsRef.current = {}
    void loadHistory({ mode: 'initial' })
  }, [projectPath, loadHistory])

  const historyItems = useMemo(() => {
    return snapshot ? toViewModel(snapshot) : []
  }, [snapshot])

  const hasMore = snapshot?.hasMore ?? false
  const nextCursor = snapshot?.nextCursor

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || isLoadingMore) {
      return
    }
    loadHistory({ cursor: nextCursor, mode: 'append' })
  }, [nextCursor, isLoadingMore, loadHistory])

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
    if (!onOpenCommitDiff || !projectPath) {
      return
    }

    const commitHash = commit.fullHash ?? commit.id
    let files = commitDetailsRef.current[commit.id]?.files ?? null

    if (!files || files.length === 0) {
      try {
        files = await invoke<CommitFileChange[]>(TauriCommands.GetGitGraphCommitFiles, {
          repoPath: projectPath,
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

    onOpenCommitDiff({ repoPath: projectPath, commit, files, initialFilePath: filePath })
  }, [onOpenCommitDiff, projectPath, pushToast])

  useEffect(() => {
    commitDetailsRef.current = commitDetails
  }, [commitDetails])

  const processRefreshQueue = useCallback(
    async () => {
      if (refreshProcessingRef.current || !projectPath) {
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
          await loadHistory({ mode: 'refresh' })
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
    [projectPath, loadHistory]
  )

  const enqueueRefreshHead = useCallback(
    (head: string) => {
      if (!projectPath) {
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
    [projectPath, processRefreshQueue]
  )

  const handleFileChanges = useCallback(
    (payload: EventPayloadMap[SchaltEvent.FileChanges]) => {
      if (!projectPath || !hasLoadedRef.current) {
        return
      }

      const nextHead = payload?.branch_info?.head_commit?.trim()
      if (!nextHead) {
        return
      }

      if (latestHeadRef.current && latestHeadRef.current === nextHead) {
        return
      }

      enqueueRefreshHead(nextHead)
    },
    [projectPath, enqueueRefreshHead]
  )

  useEffect(() => {
    let isMounted = true
    let unlisten: (() => void) | null = null

    const attach = async () => {
      try {
        const unlistenFileChanges = await listenEvent(SchaltEvent.FileChanges, handleFileChanges)
        if (!isMounted) {
          unlistenFileChanges()
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
        unlisten()
        unlisten = null
      }
    }
  }, [handleFileChanges])

  const handleToggleCommitDetails = useCallback((viewModel: HistoryItemViewModel) => {
    if (!projectPath) {
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
      repoPath: projectPath,
      commitHash,
    })
      .then(files => {
        if (activeProjectRef.current !== projectPath) {
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
        if (activeProjectRef.current !== projectPath) {
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
  }, [projectPath])

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

  if (!projectPath) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No project selected
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
