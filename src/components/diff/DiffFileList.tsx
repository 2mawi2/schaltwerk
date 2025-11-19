import { useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { useSelection } from '../../hooks/useSelection'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary, VscDiscard, VscFolder } from 'react-icons/vsc'
import clsx from 'clsx'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { AnimatedText } from '../common/AnimatedText'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { ConfirmDiscardDialog } from '../common/ConfirmDiscardDialog'
import type { ChangedFile } from '../../common/events'
import { DiffChangeBadges } from './DiffChangeBadges'
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'
import { theme } from '../../common/theme'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { isSessionMissingError } from '../../types/errors'
import { FileTree } from './FileTree'
import type { FileNode } from '../../utils/folderTree'

interface DiffFileListProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isCommander?: boolean
  getCommentCountForFile?: (filePath: string) => number
  selectedFilePath?: string | null
  onFilesChange?: (hasFiles: boolean) => void
}

const serializeChangedFileSignature = (file: ChangedFile) => {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  const changes = file.changes ?? additions + deletions
  const isBinary = file.is_binary ? '1' : '0'
  return `${file.path}:${file.change_type}:${additions}:${deletions}:${changes}:${isBinary}`
}

const safeUnlisten = (unlisten: (() => void) | null, label: string) => {
  if (!unlisten) {
    return
  }
  try {
    const result = unlisten() as void | PromiseLike<unknown>
    if (result && typeof result === 'object' && 'then' in result) {
      void (result as PromiseLike<unknown>).then(undefined, (error: unknown) => {
        logger.warn(`[DiffFileList] Failed to unlisten ${label}`, error)
      })
    }
  } catch (error) {
    logger.warn(`[DiffFileList] Failed to unlisten ${label}`, error)
  }
}

export function DiffFileList({ onFileSelect, sessionNameOverride, isCommander, getCommentCountForFile, selectedFilePath, onFilesChange }: DiffFileListProps) {
  const { selection } = useSelection()
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{
    currentBranch: string,
    baseBranch: string,
    baseCommit: string,
    headCommit: string
  } | null>(null)
  const [hasLoadedInitialResult, setHasLoadedInitialResult] = useState(false)

  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)
  const [isResetting, setIsResetting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardBusy, setDiscardBusy] = useState(false)
  const [pendingDiscardFile, setPendingDiscardFile] = useState<string | null>(null)
  const lastResultRef = useRef<string>('')
  const lastSessionKeyRef = useRef<string | null>(null)
  const sessionDataCacheRef = useRef<Map<string, {
    files: ChangedFile[]
    branchInfo: {
      currentBranch: string
      baseBranch: string
      baseCommit: string
      headCommit: string
    } | null
    signature: string
  }>>(new Map())
  const loadTokenRef = useRef(0)
  const inFlightSessionKeyRef = useRef<string | null>(null)
  const currentProjectPath = useAtomValue(projectPathAtom)
  const projectPathRef = useRef<string | null>(currentProjectPath)
  projectPathRef.current = currentProjectPath
  const activeLoadPromiseRef = useRef<Promise<void> | null>(null)
  const activeLoadSessionRef = useRef<string | null>(null)
  
  // Use refs to track current values without triggering effect recreations
  const currentPropsRef = useRef({ sessionNameOverride, selection, isCommander })
  currentPropsRef.current = { sessionNameOverride, selection, isCommander }
  
  // Store the load function in a ref so it doesn't change between renders
  const loadChangedFilesRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const cancelledSessionsRef = useRef<Set<string>>(new Set())
  
  const getSessionKey = (session: string | null | undefined, commander: boolean | undefined) => {
    if (commander && !session) return ORCHESTRATOR_SESSION_NAME
    if (!session) return 'no-session'
    return `session:${session}`
  }

  loadChangedFilesRef.current = () => {
    const loadPromise = (async () => {
      const { sessionNameOverride: overrideSnapshot, selection: selectionSnapshot, isCommander: commanderSnapshot } = currentPropsRef.current
      const targetSession = overrideSnapshot ?? (selectionSnapshot.kind === 'session' ? selectionSnapshot.payload : null)
      const sessionKey = getSessionKey(targetSession, commanderSnapshot)
      activeLoadSessionRef.current = targetSession ?? null

      if (isLoading && inFlightSessionKeyRef.current === sessionKey) {
        return
      }

      const token = ++loadTokenRef.current
      inFlightSessionKeyRef.current = sessionKey
      setIsLoading(true)

      const shouldApply = () => {
        if (loadTokenRef.current !== token) return false
        const { sessionNameOverride: latestOverride, selection: latestSelection, isCommander: latestCommander } = currentPropsRef.current
        const latestSession = latestOverride ?? (latestSelection.kind === 'session' ? latestSelection.payload : null)
        const latestKey = getSessionKey(latestSession, latestCommander)
        return latestKey === sessionKey
      }

      let currentSessionDuringLoad: string | null = null
      let commanderDuringLoad = false

      try {
        const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentIsCommander } = currentPropsRef.current
        const selectionSession =
          currentSelection.kind === 'session' ? currentSelection.payload ?? null : null
        const currentSession = (currentOverride ?? selectionSession) ?? null
        currentSessionDuringLoad = currentSession
        commanderDuringLoad = Boolean(currentIsCommander)

        // Don't try to load files for cancelled sessions
        if (currentSession && cancelledSessionsRef.current.has(currentSession)) {
          return
        }

        // For orchestrator mode (no session), get working changes
        if (commanderDuringLoad && !currentSession) {
          const [changedFiles, currentBranch] = await Promise.all([
            invoke<ChangedFile[]>(TauriCommands.GetOrchestratorWorkingChanges),
            invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: null })
          ])

          // Check if results actually changed to avoid unnecessary re-renders
          const resultSignature = `orchestrator-${changedFiles.length}-${changedFiles.map(serializeChangedFileSignature).join(',')}-${currentBranch}`
          const cachedPayload = {
            files: changedFiles,
            branchInfo: {
              currentBranch,
              baseBranch: 'Working Directory',
              baseCommit: 'HEAD',
              headCommit: 'Working'
            },
            signature: resultSignature
          }

          sessionDataCacheRef.current.set(sessionKey, cachedPayload)

          if (shouldApply()) {
            lastResultRef.current = resultSignature
            lastSessionKeyRef.current = sessionKey
            setFiles(cachedPayload.files)
            setBranchInfo(cachedPayload.branchInfo)
            setHasLoadedInitialResult(true)
          }
          return
        }

        // Regular session mode
        if (!currentSession) {
          // Clear data when no session selected to prevent stale data
          if (lastResultRef.current !== 'no-session') {
            lastResultRef.current = 'no-session'
            lastSessionKeyRef.current = getSessionKey(null, false)
            setFiles([])
            setBranchInfo(null)
            setHasLoadedInitialResult(true)
          }
          return
        }
        
        const [changedFiles, currentBranch, baseBranch, [baseCommit, headCommit]] = await Promise.all([
          invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName: currentSession }),
          invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: currentSession }),
          invoke<string>(TauriCommands.GetBaseBranchName, { sessionName: currentSession }),
          invoke<[string, string]>(TauriCommands.GetCommitComparisonInfo, { sessionName: currentSession })
        ])
        
        // Check if results actually changed to avoid unnecessary re-renders
        // Include session name in signature to ensure different sessions don't share cached results
        const resultSignature = `session-${currentSession}-${changedFiles.length}-${changedFiles.map(serializeChangedFileSignature).join(',')}-${currentBranch}-${baseBranch}`

        const cachedPayload = {
          files: changedFiles,
          branchInfo: {
            currentBranch,
            baseBranch,
            baseCommit,
            headCommit
          },
          signature: resultSignature
        }

        sessionDataCacheRef.current.set(sessionKey, cachedPayload)

        if (shouldApply()) {
          lastResultRef.current = resultSignature
          lastSessionKeyRef.current = sessionKey
          setFiles(cachedPayload.files)
          setBranchInfo(cachedPayload.branchInfo)
          setHasLoadedInitialResult(true)
        }
      } catch (error: unknown) {
        const message = String(error ?? '')
        const normalizedMessage = message.toLowerCase()
        const missingWorktree =
          normalizedMessage.includes('no such file or directory') ||
          normalizedMessage.includes('code=notfound') ||
          normalizedMessage.includes('session not found') ||
          normalizedMessage.includes('failed to resolve path') ||
          normalizedMessage.includes('failed to get session') ||
          normalizedMessage.includes('query returned no rows') ||
          isSessionMissingError(error)

        if (missingWorktree) {
          if (currentSessionDuringLoad) {
            cancelledSessionsRef.current.add(currentSessionDuringLoad)
            try {
              await invoke(TauriCommands.StopFileWatcher, { sessionName: currentSessionDuringLoad })
            } catch (stopError) {
              logger.debug('[DiffFileList] Unable to stop file watcher after session removal', stopError)
            }
          }
        } else {
          logger.error(`Failed to load changed files:`, error)
        }

        if (!shouldApply()) {
          if (sessionKey !== 'no-session') {
            sessionDataCacheRef.current.delete(sessionKey)
          }
          return
        }

        setFiles([])
        setBranchInfo(null)
        setHasLoadedInitialResult(true)
        lastResultRef.current = ''
        lastSessionKeyRef.current = sessionKey
        if (sessionKey !== 'no-session') {
          sessionDataCacheRef.current.delete(sessionKey)
        }
      } finally {
        if (loadTokenRef.current === token) {
          setIsLoading(false)
          inFlightSessionKeyRef.current = null
        }
      }
    })()

    activeLoadPromiseRef.current = loadPromise

    return loadPromise.finally(() => {
      if (activeLoadPromiseRef.current === loadPromise) {
        activeLoadPromiseRef.current = null
        activeLoadSessionRef.current = null
      }
    })
  }
  
  // Stable function that calls the ref
  const loadChangedFiles = useCallback(async () => {
    await loadChangedFilesRef.current?.()
  }, [])

  // Path resolver used by top bar now; no local button anymore
  
  useEffect(() => {
    // Reset component state immediately when session changes
    const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentIsCommander } = currentPropsRef.current
    const currentSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
    
    const newSessionKey = getSessionKey(currentSession, currentIsCommander)
    const previousSessionKey = lastSessionKeyRef.current

    if (!currentSession && !currentIsCommander) {
      // Clear files when no session and not orchestrator
      setFiles([])
      setBranchInfo(null)
      setHasLoadedInitialResult(true)
      lastResultRef.current = 'no-session'
      lastSessionKeyRef.current = getSessionKey(null, false)
      return
    }

    // CRITICAL: Clear stale data immediately when session changes
    // This prevents showing old session data while new session data loads
    const cachedData = sessionDataCacheRef.current.get(newSessionKey)
    const needsDataClear = previousSessionKey !== null && previousSessionKey !== newSessionKey

    if (cachedData) {
      setFiles(cachedData.files)
      setBranchInfo(cachedData.branchInfo)
      setHasLoadedInitialResult(true)
      lastResultRef.current = cachedData.signature
      lastSessionKeyRef.current = newSessionKey
    } else if (needsDataClear) {
      setFiles([])
      setBranchInfo(null)
      setHasLoadedInitialResult(false)
      lastResultRef.current = ''
      lastSessionKeyRef.current = newSessionKey
    }

    // Only load if we don't already have data for this session or if we just cleared stale data
    const hasDataForCurrentSession = lastResultRef.current !== '' && lastSessionKeyRef.current === newSessionKey
    if (!hasDataForCurrentSession || needsDataClear) {
      void loadChangedFiles()
    }

    let pollInterval: NodeJS.Timeout | null = null
    let eventUnlisten: (() => void) | null = null
    let gitStatsUnlisten: (() => void) | null = null
    let orchestratorListenerCancelled = false
    let orchestratorTimeout: ReturnType<typeof setTimeout> | null = null
    let sessionCancellingUnlisten: (() => void) | null = null
    let isCancelled = false
    let watcherStarted = false

    // Setup async operations
    const setup = async () => {
      if (currentSession) {
        if (cancelledSessionsRef.current.has(currentSession)) {
          logger.debug(`[DiffFileList] Skipping watcher setup for missing session ${currentSession}`)
          return
        }
        const pendingLoad = activeLoadPromiseRef.current
        if (pendingLoad && activeLoadSessionRef.current === currentSession) {
          try {
            await pendingLoad
          } catch {
            // Ignore errors here; they will be handled by the load logic.
          }
        }
        if (cancelledSessionsRef.current.has(currentSession)) {
          logger.debug(`[DiffFileList] Skipping watcher setup for missing session ${currentSession}`)
          return
        }
      }

      // Listen for session cancelling to stop polling immediately
      if (currentSession) {
        sessionCancellingUnlisten = await listenEvent(SchaltEvent.SessionCancelling, (event) => {
          if (event.session_name === currentSession) {
            logger.info(`Session ${currentSession} is being cancelled, stopping file watcher and polling`)
            isCancelled = true
            // Mark session as cancelled to prevent future loads
            cancelledSessionsRef.current.add(currentSession)
            // Clear data immediately
            setFiles([])
            setBranchInfo(null)
            setHasLoadedInitialResult(true)
            sessionDataCacheRef.current.delete(getSessionKey(currentSession, false))
            // Stop polling
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
            invoke(TauriCommands.StopFileWatcher, { sessionName: event.session_name }).catch(err => {
              logger.warn('[DiffFileList] Failed to stop file watcher during cancellation', err)
            })
          }
        })
      }
      
      // For orchestrator mode, poll less frequently since working directory changes are less frequent
      if (currentIsCommander && !currentSession) {
        pollInterval = setInterval(() => {
          if (!isCancelled) {
            void loadChangedFiles()
          }
        }, 5000) // Poll every 5 seconds for orchestrator
      } else {
        // Try to start file watcher for session mode
        try {
          await invoke(TauriCommands.StartFileWatcher, { sessionName: currentSession })
          watcherStarted = true
          logger.info(`File watcher started for session: ${currentSession}`)
        } catch (error) {
          const missingSession = isSessionMissingError(error)
          if (missingSession) {
            logger.debug(
              `[DiffFileList] Session ${currentSession ?? 'unknown'} missing while starting file watcher, falling back to polling`,
              error
            )
            if (currentSession) {
              cancelledSessionsRef.current.add(currentSession)
            }
          } else {
            logger.error('Failed to start file watcher, falling back to polling:', error)
          }
          // Fallback to polling if file watcher fails
          pollInterval = setInterval(() => {
            if (!isCancelled) {
              void loadChangedFiles()
            }
          }, 3000)
        }
      }

      // Always set up event listener (even if watcher failed, in case it recovers)
      try {
        eventUnlisten = await listenEvent(SchaltEvent.FileChanges, (event) => {
          // CRITICAL: Only update if this event is for the currently selected session
          const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentCommander } = currentPropsRef.current
          const currentlySelectedSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
          const commanderSelected = currentCommander && currentSelection.kind === 'orchestrator'
          const isSessionMatch = Boolean(currentlySelectedSession) && event.session_name === currentlySelectedSession
          const isCommanderMatch = commanderSelected && event.session_name === ORCHESTRATOR_SESSION_NAME
          if (!isSessionMatch && !isCommanderMatch) {
            return
          }

          const branchInfoPayload = {
            currentBranch: event.branch_info.current_branch,
            baseBranch: event.branch_info.base_branch,
            baseCommit: event.branch_info.base_commit,
            headCommit: event.branch_info.head_commit
          }

          const signature = isCommanderMatch
            ? `${ORCHESTRATOR_SESSION_NAME}-${event.changed_files.length}-${event.changed_files.map(serializeChangedFileSignature).join(',')}-${event.branch_info.current_branch}`
            : `session-${currentlySelectedSession}-${event.changed_files.length}-${event.changed_files.map(serializeChangedFileSignature).join(',')}-${event.branch_info.current_branch}-${event.branch_info.base_branch}`

          const cacheKey = isCommanderMatch
            ? getSessionKey(null, true)
            : getSessionKey(currentlySelectedSession, false)

          setFiles(event.changed_files)
          setBranchInfo(branchInfoPayload)
          setHasLoadedInitialResult(true)

          lastResultRef.current = signature
          lastSessionKeyRef.current = cacheKey
          sessionDataCacheRef.current.set(cacheKey, {
            files: event.changed_files,
            branchInfo: branchInfoPayload,
            signature
          })

          // If we receive events, we can stop polling
          if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
          }
        })
      } catch (error) {
        logger.error('Failed to set up event listener:', error)
      }

      orchestratorTimeout = setTimeout(() => {
        void (async () => {
          try {
            const unlisten = await listenEvent(SchaltEvent.SessionGitStats, (event) => {
              if (event.session_name !== ORCHESTRATOR_SESSION_NAME) return
              const { selection: currentSelection, isCommander: currentCommander } = currentPropsRef.current
              const commanderSelected = currentCommander && currentSelection.kind === 'orchestrator'
              if (!commanderSelected) return
              void loadChangedFiles()
            })
            if (orchestratorListenerCancelled) {
              safeUnlisten(unlisten, 'session-git-stats-pending')
              return
            }
            gitStatsUnlisten = unlisten
          } catch (error) {
            logger.error('Failed to set up git stats listener:', error)
          }
        })()
      }, 0)
    }

    void setup()

    return () => {
      // Stop file watcher
      if (currentSession && watcherStarted) {
        invoke(TauriCommands.StopFileWatcher, { sessionName: currentSession }).catch(err => logger.error("Error:", err))
      }
      // Clean up event listeners
      orchestratorListenerCancelled = true
      if (orchestratorTimeout !== null) {
        clearTimeout(orchestratorTimeout)
        orchestratorTimeout = null
      }
      safeUnlisten(eventUnlisten, 'file-changes')
      safeUnlisten(gitStatsUnlisten, 'session-git-stats')
      safeUnlisten(sessionCancellingUnlisten, 'session-cancelling')
      // Clean up polling if active
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [sessionNameOverride, selection, isCommander, loadChangedFiles])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let disposed = false

    const setup = async () => {
      try {
        const remove = await listenUiEvent(UiEvent.ProjectSwitchComplete, payload => {
          const payloadPath = (payload as { projectPath?: string } | undefined)?.projectPath ?? ''
          const currentPath = projectPathRef.current ?? ''
          if (payloadPath && currentPath && payloadPath !== currentPath) {
            return
          }

          loadTokenRef.current += 1
          inFlightSessionKeyRef.current = null
          sessionDataCacheRef.current.clear()
          cancelledSessionsRef.current.clear()
          lastResultRef.current = ''
          lastSessionKeyRef.current = null
          setFiles([])
          setBranchInfo(null)
          setHasLoadedInitialResult(false)
          setIsLoading(false)
          void loadChangedFiles()
        })
        if (disposed) {
          await remove()
          return
        }
        unlisten = remove
      } catch (error) {
        logger.warn('[DiffFileList] Failed to listen for project switch events', error)
      }
    }

    void setup()

    return () => {
      disposed = true
      if (unlisten) {
        const cleanup = unlisten
        unlisten = null
        try {
          cleanup()
        } catch (error) {
          logger.warn('[DiffFileList] Failed to remove project switch listener', error)
        }
      }
    }
  }, [loadChangedFiles])
  
  const handleFileClick = (file: ChangedFile) => {
    setSelectedFile(file.path)
    onFileSelect(file.path)
  }

  useEffect(() => {
    if (typeof selectedFilePath === 'string' && selectedFilePath !== selectedFile) {
      setSelectedFile(selectedFilePath)
    } else if (selectedFilePath === null && selectedFile !== null) {
      setSelectedFile(null)
    }
  }, [selectedFilePath, selectedFile])

  useEffect(() => {
    if (!hasLoadedInitialResult) {
      return
    }
    onFilesChange?.(files.length > 0)
  }, [files, hasLoadedInitialResult, onFilesChange])
  
  const getFileIcon = (changeType: string, filePath: string) => {
    if (isBinaryFileByExtension(filePath)) {
      return <VscFileBinary className="text-slate-400" />
    }
    
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-cyan-400" />
    }
  }

  const confirmReset = useCallback(() => {
    if (!sessionName || isCommander) return
    setConfirmOpen(true)
  }, [sessionName, isCommander])

  const handleResetSession = useCallback(async () => {
    if (!sessionName || isCommander) return
    setIsResetting(true)
    try {
      await invoke(TauriCommands.SchaltwerkCoreResetSessionWorktree, { sessionName })
      await loadChangedFilesRef.current()
      emitUiEvent(UiEvent.TerminalReset, { kind: 'session', sessionId: sessionName })
    } catch (e) {
      logger.error('Failed to reset session from header:', e)
    } finally {
      setIsResetting(false)
      setConfirmOpen(false)
    }
  }, [sessionName, isCommander])

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      let basePath: string

      if (isCommander && !sessionName) {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      } else if (sessionName) {
        const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
        basePath = sessionData.worktree_path
      } else {
        logger.warn('Cannot open file: no session or orchestrator context')
        return
      }

      const fullPath = `${basePath}/${filePath}`
      const defaultAppId = await invoke<string>(TauriCommands.GetDefaultOpenApp)
      await invoke(TauriCommands.OpenInApp, { appId: defaultAppId, worktreePath: fullPath })
    } catch (e) {
      logger.error('Failed to open file:', filePath, e)
      const errorMessage = typeof e === 'string' ? e : ((e as Error)?.message || String(e) || 'Unknown error')
      alert(errorMessage)
    }
  }, [sessionName, isCommander])

  const renderFileNode = (node: FileNode, depth: number) => {
    const additions = node.file.additions ?? 0
    const deletions = node.file.deletions ?? 0
    const totalChanges = node.file.changes ?? additions + deletions
    const isBinary = node.file.is_binary ?? (node.file.change_type !== 'deleted' && isBinaryFileByExtension(node.file.path))
    const commentCount = getCommentCountForFile ? getCommentCountForFile(node.file.path) : 0

    return (
      <div
        key={node.path}
        className={clsx(
          'flex items-start gap-3 rounded cursor-pointer',
          'hover:bg-slate-800/50',
          selectedFile === node.file.path && 'bg-slate-800/30'
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px`, paddingTop: '4px', paddingBottom: '4px' }}
        onClick={() => handleFileClick(node.file)}
        data-selected={selectedFile === node.file.path}
        data-file-path={node.file.path}
      >
        {getFileIcon(node.file.change_type, node.file.path)}
        <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 justify-between">
            <div className="text-sm truncate font-medium" style={{ color: theme.colors.text.primary }}>
              {node.name}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {commentCount > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: theme.colors.accent.blue.bg,
                    color: theme.colors.accent.blue.light
                  }}
                  aria-label={`${commentCount} comments on ${node.file.path}`}
                >
                  {commentCount}
                </span>
              )}
              <DiffChangeBadges
                additions={additions}
                deletions={deletions}
                changes={totalChanges}
                isBinary={isBinary}
                className="flex-shrink-0"
                layout="row"
                size="compact"
              />
            </div>
          </div>
        </div>
        <button
          title="Open file in editor"
          aria-label={`Open ${node.file.path}`}
          className="ml-2 p-1 rounded hover:bg-slate-800"
          style={{ color: theme.colors.text.secondary }}
          onClick={(e) => {
            e.stopPropagation()
            void handleOpenFile(node.file.path)
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.text.primary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.text.secondary
          }}
        >
          <VscFolder className="text-base" />
        </button>
        <button
          title="Discard changes for this file"
          aria-label={`Discard ${node.file.path}`}
          className="p-1 rounded hover:bg-slate-800 text-slate-300"
          onClick={(e) => {
            e.stopPropagation()
            setPendingDiscardFile(node.file.path)
            setDiscardOpen(true)
          }}
        >
          <VscDiscard className="text-base" />
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="h-full flex flex-col bg-panel">
      <div className="px-3 py-2 border-b border-slate-800 relative">
        <div className="flex items-center justify-between pr-12">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {isCommander && !sessionName 
                ? 'Uncommitted Changes' 
                : branchInfo?.baseCommit 
                  ? `Changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
                  : `Changes from ${branchInfo?.baseBranch || 'base'}`}
            </span>
            {branchInfo && !isCommander && (
              <span className="text-xs text-slate-500">
                ({branchInfo.headCommit} → {branchInfo.baseCommit})
              </span>
            )}
            {branchInfo && isCommander && (
              <span className="text-xs text-slate-500">
                (on {branchInfo.currentBranch})
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {branchInfo && files.length > 0 && (
              <div className="text-xs text-slate-500">
                {files.length} files changed
              </div>
            )}
            {sessionName && !isCommander && (
              <div>
                {isResetting ? (
                  <AnimatedText text="resetting" size="xs" />
                ) : (
                  <button
                    title={files.length > 0 ? 'Reset session' : 'No changes to reset'}
                    aria-label="Reset session"
                    onClick={files.length > 0 ? confirmReset : undefined}
                    disabled={files.length === 0}
                    className={`p-1 rounded ${files.length > 0 ? 'hover:bg-slate-800' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <VscDiscard className="text-lg" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {sessionName === null && !isCommander ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-slate-500">
            <div className="text-sm">No session selected</div>
            <div className="text-xs mt-1">Select a session to view changes</div>
          </div>
        </div>
      ) : files.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-2">
            <FileTree files={files} renderFileNode={renderFileNode} />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="mb-1">
              {isCommander && !sessionName 
                ? 'No uncommitted changes' 
                : branchInfo?.baseCommit
                  ? `No changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
                  : `No changes from ${branchInfo?.baseBranch || 'base'}`}
            </div>
            <div className="text-xs">
              {isCommander && !sessionName 
                ? 'Your working directory is clean'
                : branchInfo?.baseCommit === branchInfo?.headCommit
                  ? `You are at the base commit (${branchInfo?.baseCommit})` 
                  : `Your session is up to date with ${branchInfo?.baseBranch || 'base'}`
              }
            </div>
          </div>
        </div>
      )}
    </div>
    <ConfirmResetDialog open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={() => { void handleResetSession() }} isBusy={isResetting} />
    <ConfirmDiscardDialog
      open={discardOpen}
      filePath={pendingDiscardFile}
      isBusy={discardBusy}
      onCancel={() => {
        setDiscardOpen(false)
        setPendingDiscardFile(null)
      }}
      onConfirm={() => {
        void (async () => {
          if (!pendingDiscardFile) return
          try {
            setDiscardBusy(true)
            if (isCommander && !sessionName) {
              await invoke(TauriCommands.SchaltwerkCoreDiscardFileInOrchestrator, { filePath: pendingDiscardFile })
            } else if (sessionName) {
              await invoke(TauriCommands.SchaltwerkCoreDiscardFileInSession, { sessionName, filePath: pendingDiscardFile })
            }
            await loadChangedFilesRef.current()
          } catch (err) {
            logger.error('Discard file failed:', err)
          } finally {
            setDiscardBusy(false)
            setDiscardOpen(false)
            setPendingDiscardFile(null)
          }
        })()
      }}
    />
    </>
  )
}
