import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary, VscDiscard, VscFolder } from 'react-icons/vsc'
import clsx from 'clsx'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { useSelection } from '../../contexts/SelectionContext'
import { useSessions } from '../../contexts/SessionsContext'
import { TauriCommands } from '../../common/tauriCommands'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { AnimatedText } from '../common/AnimatedText'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { ConfirmDiscardDialog } from '../common/ConfirmDiscardDialog'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'
import { logger } from '../../utils/logger'
import { safeUnlisten } from '../../utils/safeUnlisten'
import type { ChangedFile } from '../../common/events'
import { DiffChangeBadges } from './DiffChangeBadges'
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'
import { theme } from '../../common/theme'

interface DiffFileListProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isCommander?: boolean
}

type DiffLoaderStatus = 'ready' | 'waiting' | 'missing'

type BranchDisplayInfo = {
  currentBranch: string
  baseBranch: string
  baseCommit: string
  headCommit: string
}

type DiffCacheEntry = {
  files: ChangedFile[]
  branchInfo: BranchDisplayInfo | null
  signature: string
}

type ReloadOptions = {
  invalidateCache?: boolean
  force?: boolean
}

const NO_SESSION_KEY = 'no-session'

const serializeChangedFileSignature = (file: ChangedFile) => {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  const changes = file.changes ?? additions + deletions
  const isBinary = file.is_binary ? '1' : '0'
  return `${file.path}:${file.change_type}:${additions}:${deletions}:${changes}:${isBinary}`
}

const resolveSessionSignature = (sessionName: string, files: ChangedFile[], branchInfo: BranchDisplayInfo) => {
  return [
    'session',
    sessionName,
    files.length,
    files.map(serializeChangedFileSignature).join(','),
    branchInfo.currentBranch,
    branchInfo.baseBranch,
    branchInfo.baseCommit,
    branchInfo.headCommit,
  ].join(':')
}

const resolveOrchestratorSignature = (files: ChangedFile[], branchInfo: BranchDisplayInfo) => {
  return [
    'orchestrator',
    files.length,
    files.map(serializeChangedFileSignature).join(','),
    branchInfo.currentBranch,
    branchInfo.baseBranch,
    branchInfo.baseCommit,
    branchInfo.headCommit,
  ].join(':')
}

const isSessionMissingError = (error: unknown) => {
  if (!error) {
    return false
  }

  if (typeof error === 'string') {
    return error.includes('not found')
  }

  if (error instanceof Error) {
    return error.message.includes('not found')
  }

  if (typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return ((error as { message: string }).message).includes('not found')
  }

  return false
}

const getSessionKey = (sessionName: string | null, isCommander: boolean) => {
  if (isCommander && !sessionName) {
    return ORCHESTRATOR_SESSION_NAME
  }

  if (!sessionName) {
    return NO_SESSION_KEY
  }

  return `session:${sessionName}`
}

function useDiffLoaderStatus(sessionName: string | null, isCommander: boolean) {
  const { loadingState, allSessions } = useSessions()

  const sessionExists = useMemo(() => {
    if (!sessionName) {
      return false
    }

    return allSessions.some(session => session.info.session_id === sessionName)
  }, [sessionName, allSessions])

  const resolveInitialStatus = () => {
    if (isCommander || !sessionName) {
      return 'ready'
    }

    return loadingState === 'idle'
      ? (sessionExists ? 'ready' : 'missing')
      : 'waiting'
  }

  const [status, setStatus] = useState<DiffLoaderStatus>(resolveInitialStatus)

  useEffect(() => {
    if (isCommander || !sessionName) {
      setStatus('ready')
      return
    }

    if (loadingState !== 'idle') {
      setStatus('waiting')
      return
    }

    setStatus(sessionExists ? 'ready' : 'missing')
  }, [isCommander, sessionName, sessionExists, loadingState])

  return { status, sessionExists }
}

function useDiffLoader({
  sessionName,
  isCommander,
  status,
  sessionExists,
}: {
  sessionName: string | null
  isCommander: boolean
  status: DiffLoaderStatus
  sessionExists: boolean
}) {
  const sessionKey = useMemo(() => getSessionKey(sessionName, isCommander), [sessionName, isCommander])
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [branchInfo, setBranchInfo] = useState<BranchDisplayInfo | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(status === 'waiting')

  const cacheRef = useRef<Map<string, DiffCacheEntry>>(new Map())
  const lastSignatureRef = useRef<string | null>(null)
  const activeLoadRef = useRef<{ key: string; token: number } | null>(null)
  const requestIdRef = useRef(0)
  const pendingReloadRef = useRef<Map<string, boolean>>(new Map())
  const statusRef = useRef<DiffLoaderStatus>(status)
  const sessionKeyRef = useRef<string>(sessionKey)
  const sessionExistsRef = useRef<boolean>(sessionExists)
  const sessionNameRef = useRef<string | null>(sessionName)
  const isCommanderRef = useRef<boolean>(isCommander)
  const cancelledSessionsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const orchestratorThrottleRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; lastTs: number }>({ timer: null, lastTs: 0 })

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    sessionKeyRef.current = sessionKey
  }, [sessionKey])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    sessionExistsRef.current = sessionExists
  }, [sessionExists])

  useEffect(() => {
    sessionNameRef.current = sessionName
  }, [sessionName])

  useEffect(() => {
    isCommanderRef.current = isCommander
  }, [isCommander])

  const applyCacheEntry = useCallback((key: string, entry: DiffCacheEntry) => {
    cacheRef.current.set(key, entry)

    if (!mountedRef.current) {
      return
    }

    if (sessionKeyRef.current !== key) {
      return
    }

    if (lastSignatureRef.current === entry.signature) {
      return
    }

    lastSignatureRef.current = entry.signature
    setFiles(entry.files)
    setBranchInfo(entry.branchInfo)
  }, [])

  const clearActiveData = useCallback(() => {
    if (!mountedRef.current) {
      return
    }
    lastSignatureRef.current = null
    setFiles([])
    setBranchInfo(null)
  }, [])

  const markReloadPending = useCallback((key: string) => {
    pendingReloadRef.current.set(key, true)
  }, [])

  const consumePendingReload = useCallback((key: string) => {
    if (!pendingReloadRef.current.has(key)) {
      return false
    }
    pendingReloadRef.current.delete(key)
    return true
  }, [])

  const shouldApply = useCallback((token: number, key: string) => {
    const active = activeLoadRef.current
    if (active && (active.key !== key || active.token !== token)) {
      return false
    }

    return mountedRef.current && sessionKeyRef.current === key && statusRef.current === 'ready'
  }, [])

  const resolveBranchInfoFromEvent = useCallback((eventBranch: { current_branch: string; base_branch: string; base_commit: string; head_commit: string }): BranchDisplayInfo => {
    return {
      currentBranch: eventBranch.current_branch,
      baseBranch: eventBranch.base_branch,
      baseCommit: eventBranch.base_commit,
      headCommit: eventBranch.head_commit,
    }
  }, [])

  const buildSessionEntry = useCallback((targetSession: string, changedFiles: ChangedFile[], info: BranchDisplayInfo): DiffCacheEntry => {
    return {
      files: changedFiles,
      branchInfo: info,
      signature: resolveSessionSignature(targetSession, changedFiles, info),
    }
  }, [])

  const buildOrchestratorEntry = useCallback((changedFiles: ChangedFile[], branch: BranchDisplayInfo): DiffCacheEntry => {
    return {
      files: changedFiles,
      branchInfo: branch,
      signature: resolveOrchestratorSignature(changedFiles, branch),
    }
  }, [])

  const load = useCallback(async ({ invalidateCache = false, force = false }: ReloadOptions = {}): Promise<void> => {
    const key = sessionKeyRef.current
    const currentStatus = statusRef.current
    const currentSessionName = sessionNameRef.current
    const commander = isCommanderRef.current

    if (currentStatus !== 'ready') {
      return
    }

    if (!commander && !currentSessionName) {
      return
    }

    if (!commander && !sessionExistsRef.current) {
      return
    }

    if (!force) {
      const active = activeLoadRef.current
      if (active && active.key === key) {
        markReloadPending(key)
        return
      }
    }

    if (invalidateCache) {
      cacheRef.current.delete(key)
      if (sessionKeyRef.current === key) {
        lastSignatureRef.current = null
      }
    }

    const token = ++requestIdRef.current
    activeLoadRef.current = { key, token }
    // Avoid flashing loader for orchestrator refreshes once initial data exists
    const avoidOrchestratorLoading = commander && !currentSessionName && Boolean(lastSignatureRef.current)
    if (!avoidOrchestratorLoading) {
      setIsLoading(true)
    }

    try {
      if (commander && !currentSessionName) {
        const [changedFiles, currentBranch] = await Promise.all([
          invoke<ChangedFile[]>(TauriCommands.GetOrchestratorWorkingChanges),
          invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: null }),
        ])

        const orchestratorBranch: BranchDisplayInfo = {
          currentBranch,
          baseBranch: 'Working Directory',
          baseCommit: 'HEAD',
          headCommit: 'Working',
        }

        const entry = buildOrchestratorEntry(changedFiles, orchestratorBranch)

        if (!shouldApply(token, key)) {
          return
        }

        applyCacheEntry(key, entry)
        return
      }

      const targetSession = currentSessionName
      if (!targetSession) {
        return
      }

      if (cancelledSessionsRef.current.has(targetSession)) {
        return
      }

      const [changedFiles, currentBranch, baseBranch, [baseCommit, headCommit]] = await Promise.all([
        invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName: targetSession }),
        invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: targetSession }),
        invoke<string>(TauriCommands.GetBaseBranchName, { sessionName: targetSession }),
        invoke<[string, string]>(TauriCommands.GetCommitComparisonInfo, { sessionName: targetSession }),
      ])

      const branchData: BranchDisplayInfo = {
        currentBranch,
        baseBranch,
        baseCommit,
        headCommit,
      }

      const entry = buildSessionEntry(targetSession, changedFiles, branchData)

      if (!shouldApply(token, key)) {
        return
      }

      applyCacheEntry(key, entry)
    } catch (error) {
      if (!shouldApply(token, key)) {
        return
      }

      if (!isSessionMissingError(error)) {
        logger.error('[DiffFileList] Failed to load changed files:', error)
      }

      cacheRef.current.delete(key)
      clearActiveData()
    } finally {
      if (activeLoadRef.current && activeLoadRef.current.key === key && activeLoadRef.current.token === token) {
        activeLoadRef.current = null
      }

      if (requestIdRef.current === token) {
        setIsLoading(false)
      }

      if (consumePendingReload(key) && statusRef.current === 'ready') {
        load({ invalidateCache: true, force: true }).catch((error) => {
          logger.debug('Background reload failed after diff load', { error })
        })
      }
    }
  }, [applyCacheEntry, buildOrchestratorEntry, buildSessionEntry, clearActiveData, consumePendingReload, markReloadPending, shouldApply])

  const stopPolling = useCallback(() => {
    if (!pollingIntervalRef.current) {
      return
    }
    clearInterval(pollingIntervalRef.current)
    pollingIntervalRef.current = null
  }, [])

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current || !mountedRef.current) {
      return
    }

    const interval = setInterval(() => {
      load({ invalidateCache: true, force: true }).catch((error) => {
        logger.debug('Polling load failed', { error })
      })
    }, 2500)

    pollingIntervalRef.current = interval
  }, [load])

  const reload = useCallback((options?: ReloadOptions) => {
    return load({ ...options, force: true })
  }, [load])

  useEffect(() => {
    const key = sessionKey
    const cached = cacheRef.current.get(key)

    if (cached) {
      lastSignatureRef.current = cached.signature
      setFiles(cached.files)
      setBranchInfo(cached.branchInfo)
      setIsLoading(false)
      load({ force: true }).catch((error) => {
        logger.debug('Background cache refresh failed', { error })
      })
      return
    }

    if (!isCommander && !sessionName) {
      clearActiveData()
      setIsLoading(false)
      return
    }

    lastSignatureRef.current = null
    cacheRef.current.delete(key)
    clearActiveData()
  }, [sessionKey, sessionName, isCommander, clearActiveData, load])

  useEffect(() => {
    if (status === 'waiting') {
      setIsLoading(true)
      return
    }

    if (status === 'missing') {
      setIsLoading(false)
      clearActiveData()
      return
    }

    if (status === 'ready') {
      if (!isCommander && !sessionName) {
        setIsLoading(false)
        return
      }

      const key = sessionKeyRef.current
      if (!cacheRef.current.has(key)) {
        load({ force: true }).catch((error) => {
          logger.debug('Initial load failed on status ready', { error })
        })
      } else {
        setIsLoading(false)
      }
    }
  }, [status, isCommander, sessionName, load, clearActiveData])

  useEffect(() => {
    const unlisten = listenUiEvent(UiEvent.ProjectSwitchComplete, () => {
      requestIdRef.current += 1
      activeLoadRef.current = null
      pendingReloadRef.current.clear()
      cacheRef.current.clear()
      cancelledSessionsRef.current.clear()
      lastSignatureRef.current = null
      clearActiveData()
      stopPolling()
      setIsLoading(statusRef.current === 'waiting')
      load({ force: true }).catch((error) => {
        logger.debug('Load after project switch failed', { error })
      })
    })

    return () => {
      void safeUnlisten(unlisten, '[DiffFileList] project switch listener cleanup')
    }
  }, [clearActiveData, load, stopPolling])

  useEffect(() => {
    stopPolling()

    if (status !== 'ready') {
      return
    }

    const currentSession = sessionName
    const commander = isCommander

    if (!commander && !currentSession) {
      return
    }

    if (!commander && !sessionExists) {
      return
    }

    let watcherStarted = false
    let disposed = false
    let fileChangesUnlisten: (() => void | Promise<void>) | null = null
    let gitStatsUnlisten: (() => void | Promise<void>) | null = null
    let sessionCancellingUnlisten: (() => void | Promise<void>) | null = null
    let sessionRemovedUnlisten: (() => void | Promise<void>) | null = null

    const setupListeners = async () => {
      if (!commander && currentSession) {
        try {
          await invoke(TauriCommands.StartFileWatcher, { sessionName: currentSession })
          watcherStarted = true
        } catch (error) {
          logger.error('[DiffFileList] Failed to start file watcher; continuing without watcher', error)
        }
      }

      if (!commander && currentSession) {
        if (watcherStarted) {
          stopPolling()
        } else {
          startPolling()
        }
      } else {
        stopPolling()
      }

      try {
        fileChangesUnlisten = await listenEvent(SchaltEvent.FileChanges, event => {
          if (disposed) {
            return
          }

          const currentCommander = isCommanderRef.current
          const selectedSession = sessionNameRef.current
          const isOrchestratorMatch = currentCommander && !selectedSession && event.session_name === ORCHESTRATOR_SESSION_NAME
          const isSessionMatch = Boolean(selectedSession) && event.session_name === selectedSession

          if (!isOrchestratorMatch && !isSessionMatch) {
            return
          }

          const entryBranch = resolveBranchInfoFromEvent(event.branch_info)

          if (isOrchestratorMatch) {
            const entry = buildOrchestratorEntry(event.changed_files, entryBranch)
            // Skip if unchanged signature
            if (lastSignatureRef.current === entry.signature) {
              setIsLoading(false)
              return
            }
            // Throttle orchestrator updates to at most once per second
            const now = Date.now()
            const minInterval = 1000
            const elapsed = now - orchestratorThrottleRef.current.lastTs
            const apply = () => {
              applyCacheEntry(ORCHESTRATOR_SESSION_NAME, entry)
              orchestratorThrottleRef.current.lastTs = Date.now()
              setIsLoading(false)
            }
            if (elapsed < minInterval) {
              if (orchestratorThrottleRef.current.timer) {
                clearTimeout(orchestratorThrottleRef.current.timer)
              }
              orchestratorThrottleRef.current.timer = setTimeout(apply, minInterval - elapsed)
            } else {
              apply()
            }
            return
          }

          if (!selectedSession) {
            return
          }

          const entry = buildSessionEntry(selectedSession, event.changed_files, entryBranch)
          applyCacheEntry(getSessionKey(selectedSession, false), entry)
          setIsLoading(false)
        })
      } catch (error) {
        logger.error('[DiffFileList] Failed to register file changes listener:', error)
      }

      try {
        gitStatsUnlisten = await listenEvent(SchaltEvent.SessionGitStats, event => {
          if (disposed) {
            return
          }

          if (event.session_name !== ORCHESTRATOR_SESSION_NAME) {
            return
          }

          const currentCommander = isCommanderRef.current
          const selectedSession = sessionNameRef.current
          if (!currentCommander || selectedSession) {
            return
          }

          // For orchestrator, rely on FileChanges events; avoid extra loads that cause UI churn
          return
        })
      } catch (error) {
        logger.error('[DiffFileList] Failed to register git stats listener:', error)
      }

      try {
        sessionCancellingUnlisten = await listenEvent(SchaltEvent.SessionCancelling, event => {
          if (disposed || !event.session_name) {
            return
          }

          cancelledSessionsRef.current.add(event.session_name)
          cacheRef.current.delete(getSessionKey(event.session_name, false))

          if (sessionNameRef.current === event.session_name) {
            clearActiveData()
            setIsLoading(false)
          }

          void invoke(TauriCommands.StopFileWatcher, { sessionName: event.session_name }).catch(err => {
            logger.warn('[DiffFileList] Failed to stop file watcher during cancellation:', err)
          })
        })
      } catch (error) {
        logger.error('[DiffFileList] Failed to register session cancelling listener:', error)
      }

      try {
        sessionRemovedUnlisten = await listenEvent(SchaltEvent.SessionRemoved, (event) => {
          if (!event?.session_name) {
            return
          }

          if (cancelledSessionsRef.current.has(event.session_name)) {
            cancelledSessionsRef.current.delete(event.session_name)
          }
        })
      } catch (error) {
        logger.error('Failed to register session removed listener:', error)
      }
    }

    void setupListeners()

    return () => {
      disposed = true

      stopPolling()

      if (!commander && currentSession && watcherStarted) {
        void invoke(TauriCommands.StopFileWatcher, { sessionName: currentSession }).catch(err => {
          logger.warn('[DiffFileList] Failed to stop file watcher on cleanup:', err)
        })
      }

      if (orchestratorThrottleRef.current.timer) {
        clearTimeout(orchestratorThrottleRef.current.timer)
        orchestratorThrottleRef.current.timer = null
      }

      void safeUnlisten(fileChangesUnlisten, '[DiffFileList] file changes cleanup')
      void safeUnlisten(gitStatsUnlisten, '[DiffFileList] git stats cleanup')
      void safeUnlisten(sessionCancellingUnlisten, '[DiffFileList] session cancelling cleanup')
      void safeUnlisten(sessionRemovedUnlisten, '[DiffFileList] session removed cleanup')
    }
  }, [
    status,
    sessionName,
    isCommander,
    sessionExists,
    sessionKey,
    applyCacheEntry,
    buildOrchestratorEntry,
    buildSessionEntry,
    clearActiveData,
    load,
    resolveBranchInfoFromEvent,
    startPolling,
    stopPolling,
  ])

  return {
    files,
    branchInfo,
    isLoading,
    reload,
  }
}

export function DiffFileList({ onFileSelect, sessionNameOverride, isCommander }: DiffFileListProps) {
  const { selection } = useSelection()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardBusy, setDiscardBusy] = useState(false)
  const [pendingDiscardFile, setPendingDiscardFile] = useState<string | null>(null)

  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload ?? null : null)
  const resolvedCommander = Boolean(isCommander)
  const { status: diffLoaderStatus, sessionExists } = useDiffLoaderStatus(sessionName, resolvedCommander)
  const { files, branchInfo, isLoading, reload } = useDiffLoader({
    sessionName,
    isCommander: resolvedCommander,
    status: diffLoaderStatus,
    sessionExists,
  })

  useEffect(() => {
    if (selectedFile && !files.some(file => file.path === selectedFile)) {
      setSelectedFile(null)
    }
  }, [files, selectedFile])

  const handleFileClick = useCallback((file: ChangedFile) => {
    setSelectedFile(file.path)
    onFileSelect(file.path)
  }, [onFileSelect])

  const getFileIcon = useCallback((changeType: string, filePath: string) => {
    if (isBinaryFileByExtension(filePath)) {
      return <VscFileBinary className="text-slate-400" />
    }

    switch (changeType) {
      case 'added':
        return <VscDiffAdded className="text-green-500" />
      case 'modified':
        return <VscDiffModified className="text-yellow-500" />
      case 'deleted':
        return <VscDiffRemoved className="text-red-500" />
      default:
        return <VscFile className="text-cyan-400" />
    }
  }, [])

  const confirmReset = useCallback(() => {
    if (!sessionName || resolvedCommander) {
      return
    }
    setConfirmOpen(true)
  }, [sessionName, resolvedCommander])

  const handleResetSession = useCallback(async () => {
    if (!sessionName || resolvedCommander) {
      return
    }

    setIsResetting(true)
    try {
      await invoke(TauriCommands.SchaltwerkCoreResetSessionWorktree, { sessionName })
      await reload({ invalidateCache: true })
      emitUiEvent(UiEvent.TerminalReset, { kind: 'session', sessionId: sessionName })
    } catch (error) {
      logger.error('[DiffFileList] Failed to reset session from header:', error)
    } finally {
      setIsResetting(false)
      setConfirmOpen(false)
    }
  }, [sessionName, resolvedCommander, reload])

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      let basePath: string

      if (resolvedCommander && !sessionName) {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      } else if (sessionName) {
        const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
        basePath = sessionData.worktree_path
      } else {
        logger.warn('[DiffFileList] Cannot open file: no session or orchestrator context')
        return
      }

      const fullPath = `${basePath}/${filePath}`
      const defaultAppId = await invoke<string>(TauriCommands.GetDefaultOpenApp)
      await invoke(TauriCommands.OpenInApp, { appId: defaultAppId, worktreePath: fullPath })
    } catch (error) {
      logger.error('[DiffFileList] Failed to open file:', filePath, error)
      const message = typeof error === 'string'
        ? error
        : (error instanceof Error ? error.message : 'Unknown error')
      alert(message)
    }
  }, [sessionName, resolvedCommander])

  // Only block the view with a loader during initial load; on subsequent refreshes keep content visible
  const showLoading = diffLoaderStatus === 'waiting' || ((resolvedCommander || Boolean(sessionName)) && isLoading && files.length === 0)

  return (
    <>
      <div className="h-full flex flex-col bg-panel">
        <div className="px-3 py-2 border-b border-slate-800 relative">
          <div className="flex items-center justify-between pr-12">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {resolvedCommander && !sessionName
                  ? 'Uncommitted Changes'
                  : branchInfo?.baseCommit
                    ? `Changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
                    : `Changes from ${branchInfo?.baseBranch || 'base'}`}
              </span>
              {branchInfo && !resolvedCommander && (
                <span className="text-xs text-slate-500">
                  ({branchInfo.headCommit} → {branchInfo.baseCommit})
                </span>
              )}
              {branchInfo && resolvedCommander && (
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
              {sessionName && !resolvedCommander && (
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

        {diffLoaderStatus === 'missing' ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
              <div className="mb-1">Session not available in this project</div>
              <div className="text-xs">Switch to a session belonging to this project to view its changes.</div>
            </div>
          </div>
        ) : sessionName === null && !resolvedCommander ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-slate-500">
              <div className="text-sm">No session selected</div>
              <div className="text-xs mt-1">Select a session to view changes</div>
            </div>
          </div>
        ) : showLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <AnimatedText text="loading" size="sm" />
          </div>
        ) : files.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-2">
              {files.map(file => {
                const additions = file.additions ?? 0
                const deletions = file.deletions ?? 0
                const totalChanges = file.changes ?? additions + deletions
                const isBinary = file.is_binary ?? (file.change_type !== 'deleted' && isBinaryFileByExtension(file.path))
                const fileName = file.path.split('/').pop() ?? file.path
                const directory = file.path.includes('/')
                  ? file.path.substring(0, file.path.lastIndexOf('/'))
                  : ''

                return (
                  <div
                    key={file.path}
                    className={clsx(
                      'flex items-start gap-3 px-2 py-2 rounded cursor-pointer',
                      'hover:bg-slate-800/50',
                      selectedFile === file.path && 'bg-slate-800/30'
                    )}
                    onClick={() => handleFileClick(file)}
                    data-selected={selectedFile === file.path}
                    data-file-path={file.path}
                  >
                    {getFileIcon(file.change_type, file.path)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 justify-between">
                        <div className="min-w-0">
                          <div className="text-sm truncate font-medium">{fileName}</div>
                          {directory && (
                            <div className="text-xs text-slate-500 truncate">{directory}</div>
                          )}
                        </div>
                        <DiffChangeBadges
                          additions={additions}
                          deletions={deletions}
                          changes={totalChanges}
                          isBinary={isBinary}
                          className="flex-shrink-0"
                          layout="column"
                          size="compact"
                        />
                      </div>
                    </div>
                    <button
                      title="Open file in editor"
                      aria-label={`Open ${file.path}`}
                      className="ml-2 p-1 rounded hover:bg-slate-800"
                      style={{ color: theme.colors.text.secondary }}
                      onClick={async (e) => {
                        e.stopPropagation()
                        await handleOpenFile(file.path)
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
                      aria-label={`Discard ${file.path}`}
                      className="p-1 rounded hover:bg-slate-800 text-slate-300"
                      onClick={async (e) => {
                        e.stopPropagation()
                        setPendingDiscardFile(file.path)
                        setDiscardOpen(true)
                      }}
                    >
                      <VscDiscard className="text-base" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
              <div className="mb-1">
                {resolvedCommander && !sessionName
                  ? 'No uncommitted changes'
                  : branchInfo?.baseCommit
                    ? `No changes from ${branchInfo.baseBranch || 'base'} (${branchInfo.baseCommit})`
                    : `No changes from ${branchInfo?.baseBranch || 'base'}`}
              </div>
              <div className="text-xs">
                {resolvedCommander && !sessionName
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
      <ConfirmResetDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleResetSession}
        isBusy={isResetting}
      />
      <ConfirmDiscardDialog
        open={discardOpen}
        filePath={pendingDiscardFile}
        isBusy={discardBusy}
        onCancel={() => {
          setDiscardOpen(false)
          setPendingDiscardFile(null)
        }}
        onConfirm={async () => {
          if (!pendingDiscardFile) {
            return
          }

          try {
            setDiscardBusy(true)
            if (resolvedCommander && !sessionName) {
              await invoke(TauriCommands.SchaltwerkCoreDiscardFileInOrchestrator, { filePath: pendingDiscardFile })
            } else if (sessionName) {
              await invoke(TauriCommands.SchaltwerkCoreDiscardFileInSession, { sessionName, filePath: pendingDiscardFile })
            }
            await reload({ invalidateCache: true })
          } catch (error) {
            logger.error('[DiffFileList] Discard file failed:', error)
          } finally {
            setDiscardBusy(false)
            setDiscardOpen(false)
            setPendingDiscardFile(null)
          }
        }}
      />
    </>
  )
}
