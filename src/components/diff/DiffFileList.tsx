import { useState, useEffect, useCallback, useMemo, useRef, type DragEvent } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { useSelection } from '../../hooks/useSelection'
import { useOpenInEditor } from '../../hooks/useOpenInEditor'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary, VscDiscard, VscGoToFile } from 'react-icons/vsc'
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
import { useAtom, useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { getErrorMessage, isSessionMissingError } from '../../types/errors'
import { FileTree } from './FileTree'
import type { FileNode, FolderNode, TreeNode } from '../../utils/folderTree'
import { TERMINAL_FILE_DRAG_TYPE, type TerminalFileDragPayload } from '../../common/dragTypes'
import { BranchSelectorPopover } from './BranchSelectorPopover'
import { CompareModeToggle } from './CompareModeToggle'
import { diffCompareModeAtomFamily } from '../../store/atoms/diffCompareMode'
import {
  buildCopyContextChangedFilesSelectionKey,
  buildCopyContextBundleSelectionKey,
  copyContextBundleSelectionAtomFamily,
  copyContextChangedFilesSelectionAtomFamily,
  type CopyContextChangedFilesSelection,
} from '../../store/atoms/copyContextSelection'

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

const isPromiseLike = <T,>(value: unknown): value is PromiseLike<T> => {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === 'function'
}

type BranchInfo = {
  baseBranch: string
  baseCommit: string
  headCommit: string
}

type EmptyStateParams = {
  isCommander: boolean
  sessionName: string | null
  compareMode: 'merge_base' | 'unpushed_only'
  branchInfo: BranchInfo | null
}

const getHeaderTitle = ({ isCommander, sessionName, compareMode, branchInfo }: EmptyStateParams): string => {
  if (isCommander && !sessionName) {
    return 'Uncommitted Changes'
  }
  if (compareMode === 'unpushed_only') {
    return 'Local changes (since last push)'
  }
  if (branchInfo?.baseCommit) {
    return `Changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
  }
  return `Changes from ${branchInfo?.baseBranch || 'base'}`
}

const getEmptyStateTitle = ({ isCommander, sessionName, compareMode, branchInfo }: EmptyStateParams): string => {
  if (isCommander && !sessionName) {
    return 'No uncommitted changes'
  }
  if (compareMode === 'unpushed_only') {
    return 'No local changes'
  }
  if (branchInfo?.baseCommit) {
    return `No changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
  }
  return `No changes from ${branchInfo?.baseBranch || 'base'}`
}

const getEmptyStateSubtitle = ({ isCommander, sessionName, compareMode, branchInfo }: EmptyStateParams): string => {
  if (isCommander && !sessionName) {
    return 'Your working directory is clean'
  }
  if (compareMode === 'unpushed_only') {
    return 'All changes have been pushed to remote'
  }
  if (branchInfo?.baseCommit === branchInfo?.headCommit) {
    return `You are at the base commit (${branchInfo?.baseCommit})`
  }
  return `Your session is up to date with ${branchInfo?.baseBranch || 'base'}`
}

const collectFilePathsFromTreeNode = (node: TreeNode, result: string[]) => {
  if (node.type === 'file') {
    result.push(node.path)
    return
  }
  for (const child of node.children) {
    collectFilePathsFromTreeNode(child, result)
  }
}

const collectFilePathsFromFolder = (folder: FolderNode): string[] => {
  const result: string[] = []
  for (const child of folder.children) {
    collectFilePathsFromTreeNode(child, result)
  }
  return result
}

export function DiffFileList({ onFileSelect, sessionNameOverride, isCommander, getCommentCountForFile, selectedFilePath, onFilesChange }: DiffFileListProps) {
  const { selection } = useSelection()
  const { openInEditor } = useOpenInEditor({ sessionNameOverride, isCommander })
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{
    currentBranch: string,
    baseBranch: string,
    baseCommit: string,
    headCommit: string,
    originalBaseBranch?: string | null
  } | null>(null)
  const [hasLoadedInitialResult, setHasLoadedInitialResult] = useState(false)

  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null) ?? null
  const compareMode = useAtomValue(diffCompareModeAtomFamily(sessionName ?? 'no-session'))
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
      originalBaseBranch?: string | null
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

  const copyContextSelectionEnabled = Boolean(sessionName && !isCommander)
  const bundleSelectionKey = useMemo(() => {
    return buildCopyContextBundleSelectionKey(currentProjectPath, sessionName ?? 'no-session')
  }, [currentProjectPath, sessionName])
  const bundleSelection = useAtomValue(copyContextBundleSelectionAtomFamily(bundleSelectionKey))
  const showCopyContextControls = copyContextSelectionEnabled && (bundleSelection.diff || bundleSelection.files)

  const copyContextSelectionKey = useMemo(() => {
    return buildCopyContextChangedFilesSelectionKey(currentProjectPath, sessionName ?? 'no-session')
  }, [currentProjectPath, sessionName])

  const [copyContextSelection, setCopyContextSelection] = useAtom(
    copyContextChangedFilesSelectionAtomFamily(copyContextSelectionKey)
  )

  const allFilePaths = useMemo(() => files.map((file) => file.path), [files])

  const selectedFilePathSet = useMemo(() => {
    if (copyContextSelection.selectedFilePaths === null) return null
    return new Set(copyContextSelection.selectedFilePaths)
  }, [copyContextSelection.selectedFilePaths])

  const selectedForCopyCount = useMemo(() => {
    if (!showCopyContextControls) return 0
    if (copyContextSelection.selectedFilePaths === null) return allFilePaths.length
    if (!selectedFilePathSet) return 0
    let count = 0
    for (const path of allFilePaths) {
      if (selectedFilePathSet.has(path)) count += 1
    }
    return count
  }, [allFilePaths, copyContextSelection.selectedFilePaths, selectedFilePathSet, showCopyContextControls])

  const copyContextMasterCheckboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showCopyContextControls) return
    const el = copyContextMasterCheckboxRef.current
    if (!el) return
    const total = allFilePaths.length
    const some = selectedForCopyCount > 0
    const all = total > 0 && selectedForCopyCount === total
    el.indeterminate = some && !all
  }, [allFilePaths.length, selectedForCopyCount, showCopyContextControls])

  const isSelectedForCopyContext = useCallback((filePath: string) => {
    if (!showCopyContextControls) return true
    if (copyContextSelection.selectedFilePaths === null) return true
    return Boolean(selectedFilePathSet?.has(filePath))
  }, [copyContextSelection.selectedFilePaths, selectedFilePathSet, showCopyContextControls])

  const setAllSelectedForCopyContext = useCallback((enabled: boolean) => {
    if (!showCopyContextControls) return
    void setCopyContextSelection({ selectedFilePaths: enabled ? null : [] })
  }, [setCopyContextSelection, showCopyContextControls])

  const normalizeSelectedForCopyContext = useCallback((paths: Set<string>) => {
    if (paths.size === allFilePaths.length) return null
    return allFilePaths.filter((path) => paths.has(path))
  }, [allFilePaths])

  const toggleSelectedForCopyContext = useCallback((filePath: string) => {
    if (!showCopyContextControls) return

    void setCopyContextSelection((prev) => {
      const previous = isPromiseLike<CopyContextChangedFilesSelection>(prev)
        ? { selectedFilePaths: null }
        : (prev as CopyContextChangedFilesSelection)

      const prevSelected = previous.selectedFilePaths
      if (prevSelected === null) {
        return { selectedFilePaths: allFilePaths.filter((path) => path !== filePath) }
      }

      const next = new Set(prevSelected)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }

      return { selectedFilePaths: normalizeSelectedForCopyContext(next) }
    })
  }, [allFilePaths, normalizeSelectedForCopyContext, setCopyContextSelection, showCopyContextControls])

  const setManySelectedForCopyContext = useCallback((filePaths: string[], enabled: boolean) => {
    if (!showCopyContextControls) return

    const filePathSet = new Set(filePaths)

    void setCopyContextSelection((prev) => {
      const previous = isPromiseLike<CopyContextChangedFilesSelection>(prev)
        ? { selectedFilePaths: null }
        : (prev as CopyContextChangedFilesSelection)

      const prevSelected = previous.selectedFilePaths

      if (enabled) {
        if (prevSelected === null) {
          return previous
        }

        const next = new Set(prevSelected)
        for (const path of allFilePaths) {
          if (filePathSet.has(path)) next.add(path)
        }
        return { selectedFilePaths: normalizeSelectedForCopyContext(next) }
      }

      if (prevSelected === null) {
        const next = new Set(allFilePaths)
        for (const path of allFilePaths) {
          if (filePathSet.has(path)) next.delete(path)
        }
        return { selectedFilePaths: normalizeSelectedForCopyContext(next) }
      }

      const next = new Set(prevSelected)
      for (const path of prevSelected) {
        if (filePathSet.has(path)) next.delete(path)
      }

      return { selectedFilePaths: normalizeSelectedForCopyContext(next) }
    })
  }, [allFilePaths, normalizeSelectedForCopyContext, setCopyContextSelection, showCopyContextControls])
  
  // Use refs to track current values without triggering effect recreations
  const currentPropsRef = useRef({ sessionNameOverride, selection, isCommander, compareMode })
  currentPropsRef.current = { sessionNameOverride, selection, isCommander, compareMode }
  
  // Store the load function in a ref so it doesn't change between renders
  const loadChangedFilesRef = useRef<(modeOverride?: 'merge_base' | 'unpushed_only') => Promise<void>>(() => Promise.resolve())
  const cancelledSessionsRef = useRef<Set<string>>(new Set())
  
  const getSessionKey = (session: string | null | undefined, commander: boolean | undefined) => {
    if (commander && !session) return ORCHESTRATOR_SESSION_NAME
    if (!session) return 'no-session'
    return `session:${session}`
  }

  loadChangedFilesRef.current = (modeOverride?: 'merge_base' | 'unpushed_only') => {
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
        
        const effectiveCompareMode = modeOverride ?? currentPropsRef.current.compareMode
        const [changedFiles, currentBranch, baseBranch, [baseCommit, headCommit], sessionData] = await Promise.all([
          invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, {
            sessionName: currentSession,
            compareMode: effectiveCompareMode,
          }),
          invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: currentSession }),
          invoke<string>(TauriCommands.GetBaseBranchName, { sessionName: currentSession }),
          invoke<[string, string]>(TauriCommands.GetCommitComparisonInfo, { sessionName: currentSession }),
          invoke<{ original_parent_branch?: string | null }>(TauriCommands.SchaltwerkCoreGetSession, { name: currentSession })
        ])
        
        // Check if results actually changed to avoid unnecessary re-renders
        // Include session name and compare mode in signature to ensure different sessions/modes don't share cached results
        const resultSignature = `session-${currentSession}-${effectiveCompareMode}-${changedFiles.length}-${changedFiles.map(serializeChangedFileSignature).join(',')}-${currentBranch}-${baseBranch}`

        const cachedPayload = {
          files: changedFiles,
          branchInfo: {
            currentBranch,
            baseBranch,
            baseCommit,
            headCommit,
            originalBaseBranch: sessionData.original_parent_branch
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
  const loadChangedFiles = useCallback(async (modeOverride?: 'merge_base' | 'unpushed_only') => {
    await loadChangedFilesRef.current?.(modeOverride)
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
          const message = getErrorMessage(error)
          const normalized = message.toLowerCase()
          const missingWorktree =
            isSessionMissingError(error) ||
            normalized.includes('no path was found') ||
            normalized.includes('no such file or directory') ||
            normalized.includes('code=notfound') ||
            normalized.includes('failed to resolve path') ||
            normalized.includes('worktree not found') ||
            normalized.includes('session not found')

          if (missingWorktree) {
            logger.debug(
              `[DiffFileList] Session ${currentSession ?? 'unknown'} missing worktree while starting file watcher, skipping polling`,
              error,
            )
            if (currentSession) {
              cancelledSessionsRef.current.add(currentSession)
              try {
                await invoke(TauriCommands.StopFileWatcher, { sessionName: currentSession })
              } catch (stopError) {
                logger.debug('[DiffFileList] Unable to stop file watcher after missing worktree', stopError)
              }
            }
            return
          }

          logger.error('Failed to start file watcher, falling back to polling:', error)

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
          const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentCommander, compareMode: currentCompareMode } = currentPropsRef.current
          const currentlySelectedSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
          const commanderSelected = currentCommander && currentSelection.kind === 'orchestrator'
          const isSessionMatch = Boolean(currentlySelectedSession) && event.session_name === currentlySelectedSession
          const isCommanderMatch = commanderSelected && event.session_name === ORCHESTRATOR_SESSION_NAME
          if (!isSessionMatch && !isCommanderMatch) {
            return
          }

          // If user has unpushed_only mode selected, we need to re-fetch with that mode
          // because the backend file watcher always sends files computed with merge_base mode
          if (currentCompareMode === 'unpushed_only' && !isCommanderMatch) {
            void loadChangedFiles('unpushed_only')
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

  
  const handleFileDragStart = useCallback((filePath: string) => (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer) {
      return
    }

    const payload: TerminalFileDragPayload = { filePath }
    const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`

    try {
      event.dataTransfer.setData(TERMINAL_FILE_DRAG_TYPE, JSON.stringify(payload))
    } catch (error) {
      logger.debug('[DiffFileList] Failed to attach drag payload', error)
    }

    event.dataTransfer.setData('text/plain', normalizedPath)
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  const renderFileNode = (node: FileNode, depth: number) => {
    const additions = node.file.additions ?? 0
    const deletions = node.file.deletions ?? 0
    const totalChanges = node.file.changes ?? additions + deletions
    const isBinary = node.file.is_binary ?? (node.file.change_type !== 'deleted' && isBinaryFileByExtension(node.file.path))
    const commentCount = getCommentCountForFile ? getCommentCountForFile(node.file.path) : 0
    const copySelected = isSelectedForCopyContext(node.file.path)

    return (
      <div
        key={node.path}
        className={clsx(
          'group flex items-start gap-3 rounded cursor-pointer',
          'hover:bg-slate-800/50',
          selectedFile === node.file.path && 'bg-slate-800/30'
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px`, paddingTop: '4px', paddingBottom: '4px' }}
        onClick={() => handleFileClick(node.file)}
        data-selected={selectedFile === node.file.path}
        data-file-path={node.file.path}
        draggable
        onDragStart={handleFileDragStart(node.file.path)}
      >
        {getFileIcon(node.file.change_type, node.file.path)}
        <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 justify-between">
            <div className="text-sm truncate font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {node.name}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {commentCount > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: 'var(--color-accent-blue-bg)',
                    color: 'var(--color-accent-blue-light)'
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
        <div className="ml-2 flex items-center justify-end gap-1 shrink-0">
          <button
            title="Open file in editor"
            aria-label={`Open ${node.file.path}`}
            className="p-1 rounded hover:bg-slate-800"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={(e) => {
              e.stopPropagation()
              void openInEditor(node.file.path)
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-secondary)'
            }}
          >
            <VscGoToFile className="text-base" />
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
          {showCopyContextControls && (
            <input
              type="checkbox"
              aria-label={`Include ${node.file.path} in copied context`}
              checked={copySelected}
              onChange={() => toggleSelectedForCopyContext(node.file.path)}
              onClick={(e) => e.stopPropagation()}
              className="ml-1 mt-[3px] shrink-0 w-4 h-4 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ accentColor: 'var(--color-accent-blue)' }}
            />
          )}
        </div>
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
              {getHeaderTitle({ isCommander: isCommander ?? false, sessionName, compareMode, branchInfo })}
            </span>
            {branchInfo && !isCommander && sessionName && (
              <>
                <span className="text-xs text-slate-500">
                  ({branchInfo.headCommit} → {branchInfo.baseCommit})
                </span>
                <BranchSelectorPopover
                  sessionName={sessionName}
                  currentBaseBranch={branchInfo.baseBranch}
                  originalBaseBranch={branchInfo.originalBaseBranch}
                  onBranchChange={() => void loadChangedFiles()}
                />
              </>
            )}
            {branchInfo && isCommander && (
              <span className="text-xs text-slate-500">
                (on {branchInfo.currentBranch})
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {branchInfo && !isCommander && sessionName && (
              <CompareModeToggle
                sessionName={sessionName}
                onModeChange={(newMode) => void loadChangedFiles(newMode)}
              />
            )}
            {branchInfo && files.length > 0 && (
              <div className="text-xs text-slate-500">
                {files.length} files changed
              </div>
            )}
            {showCopyContextControls && files.length > 0 && (
              <label
                className="flex items-center gap-2 text-xs"
                title="Select which changed files are included when copying Diff/Files context"
              >
                <input
                  ref={copyContextMasterCheckboxRef}
                  type="checkbox"
                  aria-label="Select all changed files for copied context"
                  checked={files.length > 0 && selectedForCopyCount === files.length}
                  onChange={(e) => setAllSelectedForCopyContext(e.target.checked)}
                  className="shrink-0 w-4 h-4 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  style={{ accentColor: 'var(--color-accent-blue)' }}
                />
                <span style={{ color: 'var(--color-text-muted)' }}>
                  ({selectedForCopyCount}/{files.length})
                </span>
              </label>
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
            <FileTree
              files={files}
              renderFileNode={renderFileNode}
              renderFolderContent={(folder) => {
                if (!showCopyContextControls) {
                  return (
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                      ({folder.fileCount})
                    </span>
                  )
                }

                const folderFilePaths = collectFilePathsFromFolder(folder)
                const total = folderFilePaths.length
                let selectedCount = 0
                for (const filePath of folderFilePaths) {
                  if (isSelectedForCopyContext(filePath)) selectedCount += 1
                }
                const isAll = total > 0 && selectedCount === total
                const isSome = selectedCount > 0 && selectedCount < total

                return (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                      ({folder.fileCount})
                    </span>
                    <input
                      type="checkbox"
                      aria-label={`Include folder ${folder.path} in copied context`}
                      checked={isAll}
                      ref={(el) => {
                        if (!el) return
                        el.indeterminate = isSome
                      }}
                      onChange={(e) => setManySelectedForCopyContext(folderFilePaths, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-4 h-4 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                      style={{ accentColor: 'var(--color-accent-blue)' }}
                    />
                  </div>
                )
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="mb-1">
              {getEmptyStateTitle({ isCommander: isCommander ?? false, sessionName, compareMode, branchInfo })}
            </div>
            <div className="text-xs">
              {getEmptyStateSubtitle({ isCommander: isCommander ?? false, sessionName, compareMode, branchInfo })}
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
