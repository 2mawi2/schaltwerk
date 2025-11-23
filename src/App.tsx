import { useState, useEffect, useRef, useCallback, useMemo, useEffectEvent } from 'react'
import { SchaltEvent, listenEvent } from './common/eventSystem'
import { useMultipleShortcutDisplays } from './keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from './keyboardShortcuts/config'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import ErrorBoundary from './components/ErrorBoundary'
import SessionErrorBoundary from './components/SessionErrorBoundary'
import { UnifiedDiffModal, type HistoryDiffContext } from './components/diff/UnifiedDiffModal'
import type { HistoryItem, CommitFileChange } from './components/git-graph/types'
import Split from 'react-split'
import { NewSessionModal } from './components/modals/NewSessionModal'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { DeleteSpecConfirmation } from './components/modals/DeleteSpecConfirmation'
import { SettingsModal } from './components/modals/SettingsModal'
import { ProjectSelectorModal } from './components/modals/ProjectSelectorModal'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './hooks/useSelection'
import { usePreviewPanelEvents } from './hooks/usePreviewPanelEvents'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  increaseFontSizesActionAtom,
  decreaseFontSizesActionAtom,
  resetFontSizesActionAtom,
  initializeFontSizesActionAtom,
} from './store/atoms/fontSize'
import { initializeInlineDiffPreferenceActionAtom } from './store/atoms/diffPreferences'
import {
  initializeSelectionEventsActionAtom,
  setProjectPathActionAtom,
} from './store/atoms/selection'
import {
  projectPathAtom,
  projectTabsAtom,
  projectSwitchStatusAtom,
  openProjectActionAtom,
  selectProjectActionAtom,
  closeProjectActionAtom,
  deactivateProjectActionAtom,
} from './store/atoms/project'
import {
  initializeSessionsEventsActionAtom,
  initializeSessionsSettingsActionAtom,
  refreshSessionsActionAtom,
  expectSessionActionAtom,
} from './store/atoms/sessions'
import {
  leftPanelCollapsedAtom,
  leftPanelSizesAtom,
  leftPanelLastExpandedSizesAtom,
  rightPanelCollapsedAtom,
  rightPanelSizesAtom,
  rightPanelLastExpandedSizeAtom,
} from './store/atoms/layout'
import { useSessions } from './hooks/useSessions'
import { HomeScreen } from './components/home/HomeScreen'
import { TopBar } from './components/TopBar'
import { PermissionPrompt } from './components/PermissionPrompt'
import { OnboardingModal } from './components/onboarding/OnboardingModal'
import { useOnboarding } from './hooks/useOnboarding'
import { useSessionPrefill } from './hooks/useSessionPrefill'
// useRightPanelPersistence removed
import { useAttentionNotifications } from './hooks/useAttentionNotifications'
import { useAgentBinarySnapshot } from './hooks/useAgentBinarySnapshot'
import { theme } from './common/theme'
import { withOpacity } from './common/colorUtils'
import { GithubIntegrationProvider, useGithubIntegrationContext } from './contexts/GithubIntegrationContext'
import { resolveOpenPathForOpenButton } from './utils/resolveOpenPath'
import { waitForSessionsRefreshed } from './utils/waitForSessionsRefreshed'
import { TauriCommands } from './common/tauriCommands'
import { validatePanelPercentage } from './utils/panel'
import {
  UiEvent,
  listenUiEvent,
  emitUiEvent,
  SessionActionDetail,
  StartAgentFromSpecDetail,
  AgentLifecycleDetail,
  clearBackgroundStarts,
} from './common/uiEvents'
import { logger } from './utils/logger'
import { installSmartDashGuards } from './utils/normalizeCliText'
import { useKeyboardShortcutsConfig } from './contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from './keyboardShortcuts/helpers'
import { useSelectionPreserver } from './hooks/useSelectionPreserver'
import { AGENT_START_TIMEOUT_MESSAGE } from './common/agentSpawn'
import { createTerminalBackend } from './terminal/transport/backend'
import { beginSplitDrag, endSplitDrag } from './utils/splitDragCoordinator'
import { useOptionalToast } from './common/toast/ToastProvider'
import { AppUpdateResultPayload } from './common/events'
import { RawSession } from './types/session'
import { stableSessionTerminalId } from './common/terminalIdentity'
import { registerDevErrorListeners } from './dev/registerDevErrorListeners'
import { AgentCliMissingModal } from './components/agentBinary/AgentCliMissingModal'
import type { SettingsCategory } from './types/settings'
import { SPLIT_GUTTER_SIZE } from './common/splitLayout'
import { isNotificationPermissionGranted } from './utils/notificationPermission'
import { sanitizeSplitSizes, areSizesEqual } from './utils/splitStorage'

const COLLAPSED_LEFT_PANEL_PX = 50
import { finalizeSplitCommit, selectSplitRenderSizes } from './utils/splitDragState'



function AppContent() {
  const { selection } = useSelection()
  const projectPath = useAtomValue(projectPathAtom)
  const projectTabs = useAtomValue(projectTabsAtom)
  const projectSwitchStatus = useAtomValue(projectSwitchStatusAtom)
  const openProject = useSetAtom(openProjectActionAtom)
  const selectProject = useSetAtom(selectProjectActionAtom)
  const closeProject = useSetAtom(closeProjectActionAtom)
  const deactivateProject = useSetAtom(deactivateProjectActionAtom)
  const increaseFontSizes = useSetAtom(increaseFontSizesActionAtom)
  const decreaseFontSizes = useSetAtom(decreaseFontSizesActionAtom)
  const resetFontSizes = useSetAtom(resetFontSizesActionAtom)
  const initializeFontSizes = useSetAtom(initializeFontSizesActionAtom)
  const initializeInlineDiffPreference = useSetAtom(initializeInlineDiffPreferenceActionAtom)
  const initializeSelectionEvents = useSetAtom(initializeSelectionEventsActionAtom)
  const setSelectionProjectPath = useSetAtom(setProjectPathActionAtom)
  const initializeSessionsEvents = useSetAtom(initializeSessionsEventsActionAtom)
  const initializeSessionsSettings = useSetAtom(initializeSessionsSettingsActionAtom)
  const refreshSessions = useSetAtom(refreshSessionsActionAtom)
  const expectSession = useSetAtom(expectSessionActionAtom)
  const { isOnboardingOpen, completeOnboarding, closeOnboarding, openOnboarding } = useOnboarding()
  const { fetchSessionForPrefill } = useSessionPrefill()
  const github = useGithubIntegrationContext()
  const toast = useOptionalToast()
  const { beginSessionMutation, endSessionMutation, enqueuePendingStartup, allSessions } = useSessions()
  const agentLifecycleStateRef = useRef(new Map<string, { state: 'spawned' | 'ready'; timestamp: number }>())
  const [devErrorToastsEnabled, setDevErrorToastsEnabled] = useState(false)
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({})
  const [showCliMissingModal, setShowCliMissingModal] = useState(false)
  const [cliModalEverShown, setCliModalEverShown] = useState(false)
  usePreviewPanelEvents()
  const {
    loading: agentDetectLoading,
    allMissing: agentAllMissing,
    statusByAgent: agentStatusByName,
    refresh: refreshAgentDetection,
  } = useAgentBinarySnapshot()

  useEffect(() => {
    void initializeFontSizes()
    void initializeInlineDiffPreference()
  }, [initializeFontSizes, initializeInlineDiffPreference])

  useEffect(() => {
    void isNotificationPermissionGranted()
  }, [])

  useEffect(() => {
    if (agentDetectLoading) return
    if (agentAllMissing) {
      setShowCliMissingModal(true)
      setCliModalEverShown(true)
    }
  }, [agentAllMissing, agentDetectLoading])

  useEffect(() => {
    void initializeSelectionEvents()
  }, [initializeSelectionEvents])

  useEffect(() => {
    void initializeSessionsEvents()
  }, [initializeSessionsEvents])

  useEffect(() => {
    void initializeSessionsSettings()
  }, [initializeSessionsSettings, projectPath])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions, projectPath])

  useEffect(() => {
    void setSelectionProjectPath(projectPath ?? null)
  }, [projectPath, setSelectionProjectPath])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const shouldBlock = (event: DragEvent) => {
      const transfer = event.dataTransfer
      if (!transfer) {
        return false
      }

      const types = Array.from(transfer.types ?? [])
      if (types.includes('Files')) {
        return true
      }

      const items = Array.from(transfer.items ?? [])
      return items.some(item => item.kind === 'file' && item.type?.startsWith('image/'))
    }

    const blockDragAndDrop = (event: DragEvent) => {
      if (!shouldBlock(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (event.type === 'dragover' && event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
    }

    window.addEventListener('dragover', blockDragAndDrop)
    window.addEventListener('drop', blockDragAndDrop)

    return () => {
      window.removeEventListener('dragover', blockDragAndDrop)
      window.removeEventListener('drop', blockDragAndDrop)
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      setDevErrorToastsEnabled(false)
      return
    }

    let cancelled = false

    const loadPreference = async () => {
      try {
        const result = await invoke<boolean | null | undefined>(TauriCommands.GetDevErrorToastsEnabled)
        if (!cancelled) {
          if (typeof result === 'boolean') {
            setDevErrorToastsEnabled(result)
          } else {
            setDevErrorToastsEnabled(true)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setDevErrorToastsEnabled(true)
          logger.info('[App] Dev error toast preference unavailable; defaulting to enabled', error)
        }
      }
    }

    void loadPreference()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const cleanup = listenUiEvent(UiEvent.DevErrorToastPreferenceChanged, detail => {
      setDevErrorToastsEnabled(Boolean(detail?.enabled ?? true))
    })

    return cleanup
  }, [])

  useEffect(() => {
    if (!toast || !import.meta.env.DEV || !devErrorToastsEnabled) {
      return
    }

    let active = true
    let cleanup: (() => void) | undefined

    registerDevErrorListeners({
      isDev: import.meta.env.DEV,
      pushToast: toast.pushToast,
      listenBackendError: (handler) => listenEvent(SchaltEvent.DevBackendError, handler),
    }).then((dispose) => {
      if (!active) {
        dispose()
        return
      }
      cleanup = dispose
    }).catch((error) => {
      logger.warn('[App] Failed to register dev error listeners', error)
    })

    return () => {
      active = false
      cleanup?.()
    }
  }, [toast, devErrorToastsEnabled])

  useEffect(() => {
    if (!toast) return
    const spawnCleanup = listenUiEvent(UiEvent.SpawnError, (detail: { error?: string, terminalId?: string }) => {
      const description = detail?.error?.trim() || 'Agent failed to start.'
      const terminalId = detail?.terminalId
      if (terminalId) {
        const lifecycleState = agentLifecycleStateRef.current.get(terminalId)
        const isTimeout = description.includes(AGENT_START_TIMEOUT_MESSAGE)
        if (lifecycleState?.state === 'spawned' && isTimeout) {
          logger.info(`[App] Suppressing timeout toast for ${terminalId}; lifecycle indicates spawn succeeded`)
          agentLifecycleStateRef.current.delete(terminalId)
          return
        }
      }
      toast.pushToast({ tone: 'error', title: 'Failed to start agent', description })
      if (agentAllMissing && !cliModalEverShown) {
        setShowCliMissingModal(true)
        setCliModalEverShown(true)
      }
    })
    const noProjectCleanup = listenUiEvent(UiEvent.NoProjectError, (detail: { error?: string }) => {
      const description = detail?.error?.trim() || 'Open a project before starting an agent.'
      toast.pushToast({ tone: 'error', title: 'Project required', description })
    })
    const notGitCleanup = listenUiEvent(UiEvent.NotGitError, (detail: { error?: string }) => {
      const description = detail?.error?.trim() || 'Initialize a Git repository to start agents.'
      toast.pushToast({ tone: 'error', title: 'Git repository required', description })
    })
    let orchestratorCleanup: (() => void) | undefined
    void (async () => {
      try {
        orchestratorCleanup = await listenEvent(SchaltEvent.OrchestratorLaunchFailed, payload => {
          clearBackgroundStarts([payload.terminal_id])
          toast.pushToast({
            tone: 'error',
            title: 'Orchestrator failed to start',
            description: payload.error || 'Launch error. Please retry.',
            durationMs: 6000,
          })
        })
      } catch (error) {
        logger.warn('[App] Failed to listen for orchestrator launch failures', error)
      }
    })()
    return () => {
      spawnCleanup()
      noProjectCleanup()
      notGitCleanup()
      orchestratorCleanup?.()
    }
  }, [toast, agentAllMissing, cliModalEverShown])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.AgentLifecycle, (detail: AgentLifecycleDetail) => {
      if (!detail?.terminalId) return
      const timestamp = detail.occurredAtMs ?? Date.now()
      if (detail.state === 'ready' || detail.state === 'failed') {
        agentLifecycleStateRef.current.delete(detail.terminalId)
        return
      }
      agentLifecycleStateRef.current.set(detail.terminalId, { state: detail.state, timestamp })
    })
    return cleanup
  }, [])

  const onProjectChange = useEffectEvent(() => {
    github.refreshStatus().catch(error => {
      logger.warn('[App] Failed to refresh GitHub status after project change', error)
    })
  })

  useEffect(() => {
    if (!projectPath) return
    onProjectChange()
  }, [projectPath])

  useEffect(() => {
    if (!toast) return

    let disposed = false
    let unlisten: (() => void) | null = null

    const subscribe = async () => {
      try {
        const stop = await listenEvent(SchaltEvent.AppUpdateResult, (payload: AppUpdateResultPayload) => {
          logger.info('[Updater] Received result', payload)
          if (!toast) return

          if (payload.status === 'updated') {
            const versionLabel = payload.newVersion ?? payload.currentVersion
            if (payload.initiatedBy === 'auto' && payload.newVersion) {
              if (lastAutoUpdateVersionRef.current === payload.newVersion) {
                return
              }
              lastAutoUpdateVersionRef.current = payload.newVersion
            }

            toast.pushToast({
              tone: 'success',
              title: `Schaltwerk updated to ${versionLabel}`,
              description: 'Restart Schaltwerk to finish applying the update.',
              durationMs: 6000,
            })
            return
          }

          if (payload.status === 'upToDate') {
            if (payload.initiatedBy === 'manual') {
              toast.pushToast({
                tone: 'info',
                title: `You're up to date`,
                description: `Schaltwerk ${payload.currentVersion} is the latest release.`,
                durationMs: 3500,
              })
            }
            return
          }

          if (payload.status === 'busy') {
            if (payload.initiatedBy === 'manual') {
              toast.pushToast({
                tone: 'warning',
                title: 'Update already running',
                description: 'Please wait for the current check to finish.',
                durationMs: 3500,
              })
            }
            return
          }

          if (payload.status === 'error') {
            const kind = payload.errorKind ?? 'unknown'
            if (payload.initiatedBy === 'auto' && kind !== 'permission') {
              logger.warn('[Updater] Auto update failed without user action required', payload)
              return
            }

            const description = (() => {
              switch (kind) {
                case 'network':
                  return 'Connect to the internet and try again.'
                case 'permission':
                  return 'Schaltwerk could not replace the application. Open it directly from /Applications or reinstall from the latest DMG.'
                case 'signature':
                  return 'The downloaded update failed verification. A fresh build will be published shortly.'
                default:
                  return payload.errorMessage ?? 'Unexpected updater error.'
              }
            })()

            toast.pushToast({
              tone: 'error',
              title: 'Update failed',
              description,
              durationMs: 7000,
            })
          }
        })

        if (disposed) {
          stop()
        } else {
          unlisten = stop
        }
      } catch (error) {
        logger.error('[Updater] Failed to attach listener', error)
      }
    }

    void subscribe()

    return () => {
      disposed = true
      if (unlisten) {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove backend error listener', error)
        }
      }
    }
  }, [toast])

  // Get dynamic shortcut displays
  const shortcuts = useMultipleShortcutDisplays([
    KeyboardShortcutAction.NewSession,
    KeyboardShortcutAction.NewSpec
  ])

  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsCategory | undefined>(undefined)
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [deleteSpecModalOpen, setDeleteSpecModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [diffViewerState, setDiffViewerState] = useState<{ mode: 'session' | 'history'; filePath: string | null; historyContext?: HistoryDiffContext } | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [pendingActivePath, setPendingActivePath] = useState<string | null>(null)
  const [startFromDraftName, setStartFromSpecName] = useState<string | null>(null)
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)
  const [openAsDraft, setOpenAsSpec] = useState(false)
  const [cachedPrompt, setCachedPrompt] = useState('')
  const [triggerOpenInApp, setTriggerOpenInApp] = useState<number>(0)
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useAtom(leftPanelCollapsedAtom)
  const [rawLeftPanelSizes, setLeftPanelSizes] = useAtom(leftPanelSizesAtom)
  const [rawLeftPanelLastExpandedSizes, setLeftPanelLastExpandedSizes] = useAtom(leftPanelLastExpandedSizesAtom)
  const [leftDragSizes, setLeftDragSizes] = useState<number[] | null>(null)
  const leftPanelSizes = useMemo(
    () => sanitizeSplitSizes(rawLeftPanelSizes, [20, 80]),
    [rawLeftPanelSizes]
  )
  const leftPanelLastExpandedSizes = useMemo(
    () => sanitizeSplitSizes(rawLeftPanelLastExpandedSizes, [20, 80]),
    [rawLeftPanelLastExpandedSizes]
  )
  const leftRenderSizes = useMemo(
    () => selectSplitRenderSizes(leftDragSizes, leftPanelSizes as [number, number], [20, 80]),
    [leftDragSizes, leftPanelSizes]
  )
  const previousFocusRef = useRef<Element | null>(null)
  const lastAutoUpdateVersionRef = useRef<string | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const isMac = platform === 'mac'
  const startShortcut = shortcuts[KeyboardShortcutAction.NewSession] || (isMac ? '⌘N' : 'Ctrl + N')
  const specShortcut = shortcuts[KeyboardShortcutAction.NewSpec] || (isMac ? '⇧⌘N' : 'Ctrl + Shift + N')
  const preserveSelection = useSelectionPreserver()
  const pendingActivePathRef = useRef<string | null>(null)
  const openProjectPaths = useMemo(() => projectTabs.map(tab => tab.projectPath), [projectTabs])
  const clearPendingPath = useCallback((path?: string | null) => {
    if (path && pendingActivePathRef.current && pendingActivePathRef.current !== path) {
      return
    }
    pendingActivePathRef.current = null
    setPendingActivePath(null)
  }, [])

  useEffect(() => {
    if (projectPath && pendingActivePathRef.current === projectPath) {
      clearPendingPath(projectPath)
    }
  }, [projectPath, clearPendingPath])

  useEffect(() => {
    const unlistenPromise = listenEvent(SchaltEvent.ProjectReady, readyPath => {
      if (typeof readyPath !== 'string') {
        return
      }
      if (!pendingActivePathRef.current) {
        return
      }
      if (pendingActivePathRef.current === readyPath) {
        clearPendingPath(readyPath)
      }
    })

    return () => {
      void unlistenPromise
        .then(unlisten => {
          unlisten()
        })
        .catch(error => {
          logger.warn('[App] Failed to detach project ready listener', error)
        })
    }
  }, [clearPendingPath])

  const handleAttentionSummaryChange = useCallback(
    ({ perProjectCounts }: { perProjectCounts: Record<string, number>; totalCount: number }) => {
      setAttentionCounts(prev => {
        const next: Record<string, number> = {}
        for (const tab of projectTabs) {
          next[tab.projectPath] = perProjectCounts[tab.projectPath] ?? 0
        }
        for (const [key, value] of Object.entries(perProjectCounts)) {
          if (!(key in next)) {
            next[key] = value
          }
        }

        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length === nextKeys.length) {
          let different = false
          for (const key of nextKeys) {
            if (prev[key] !== next[key]) {
              different = true
              break
            }
          }
          if (!different) {
            return prev
          }
        }

        return next
      })
    },
    [projectTabs]
  )

  useAttentionNotifications({
    sessions: allSessions,
    projectPath,
    openProjectPaths,
    onProjectAttentionChange: useCallback((count: number) => {
      if (!projectPath) {
        return
      }
      setAttentionCounts(prev => {
        if (prev[projectPath] === count) return prev
        return { ...prev, [projectPath]: count }
      })
    }, [projectPath]),
    onAttentionSummaryChange: handleAttentionSummaryChange,
  })

  const shouldBlockSessionModal = useCallback(
    (reason: string) => {
      if (showHome || !projectPath) {
        logger.info('[App] Ignoring modal request because Home is active or no project selected:', reason)
        return true
      }
      return false
    },
    [projectPath, showHome]
  )

  const leftSplitDraggingRef = useRef(false)

  const finalizeLeftSplitDrag = useCallback((nextSizes?: number[]) => {
    if (!leftSplitDraggingRef.current) {
      return
    }

    leftSplitDraggingRef.current = false
    endSplitDrag('app-left-panel')

    const commit = finalizeSplitCommit({
      dragSizes: leftDragSizes,
      nextSizes,
      defaults: [20, 80],
      collapsed: isLeftPanelCollapsed,
    })

    setLeftDragSizes(null)

    if (!commit) {
      return
    }

    if (!areSizesEqual(commit as [number, number], leftPanelLastExpandedSizes as [number, number])) {
      void setLeftPanelLastExpandedSizes(commit)
    }
    if (!areSizesEqual(commit as [number, number], leftPanelSizes as [number, number])) {
      void setLeftPanelSizes(commit)
    }
  }, [isLeftPanelCollapsed, leftDragSizes, leftPanelLastExpandedSizes, leftPanelSizes, setLeftPanelLastExpandedSizes, setLeftPanelSizes])

  const handleLeftSplitDragStart = useCallback(() => {
    if (isLeftPanelCollapsed) {
      return
    }
    beginSplitDrag('app-left-panel', { orientation: 'col' })
    leftSplitDraggingRef.current = true
    setLeftDragSizes(null)
  }, [isLeftPanelCollapsed])

  const handleLeftSplitDrag = useCallback((nextSizes: number[]) => {
    setLeftDragSizes(nextSizes)
  }, [])

  const handleLeftSplitDragEnd = useCallback((nextSizes: number[]) => {
    finalizeLeftSplitDrag(nextSizes)
  }, [finalizeLeftSplitDrag])

  useEffect(() => {
    const handlePointerEnd = () => finalizeLeftSplitDrag()
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handlePointerEnd)
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', handlePointerEnd)
    }
  }, [finalizeLeftSplitDrag])

  const toggleLeftPanelCollapsed = useCallback(() => {
    setLeftDragSizes(null)
    setIsLeftPanelCollapsed(prev => {
      if (prev) {
        void setLeftPanelSizes(leftPanelLastExpandedSizes as [number, number])
        return false
      }
      void setLeftPanelLastExpandedSizes(leftPanelSizes)
      return true
    })
  }, [leftPanelLastExpandedSizes, leftPanelSizes, setIsLeftPanelCollapsed, setLeftPanelLastExpandedSizes, setLeftPanelSizes, setLeftDragSizes])

  const handleOpenProject = useCallback(async (path: string) => {
    try {
      const opened = await openProject({ path })
      if (opened) {
        setShowHome(false)
        try {
          const isEmpty = await invoke<boolean>(TauriCommands.RepositoryIsEmpty)
          if (isEmpty) {
            setShowHome(true)
            emitUiEvent(UiEvent.OpenNewProjectDialog)
          }
        } catch (repoError) {
          logger.warn('Failed to check if repository is empty:', repoError)
        }
      }
    } catch (error) {
      logger.error('Failed to open project:', error)
      alert(`Failed to open project: ${error}`)
    }
  }, [openProject])

  // Right panel global state (using atoms for persistence)
  const [rightSizes, setRightSizes] = useAtom(rightPanelSizesAtom)
  const [rightDragSizes, setRightDragSizes] = useState<number[] | null>(null)
  const safeRightSizes = useMemo(
    () => sanitizeSplitSizes(rightSizes, [70, 30]),
    [rightSizes]
  )
  const rightRenderSizes = useMemo(
    () => selectSplitRenderSizes(rightDragSizes, safeRightSizes as [number, number], [70, 30]),
    [rightDragSizes, safeRightSizes]
  )
  useEffect(() => {
    if (!areSizesEqual(safeRightSizes as [number, number], rightSizes as [number, number])) {
      void setRightSizes(safeRightSizes as [number, number])
    }
  }, [safeRightSizes, rightSizes, setRightSizes])
  const [isRightCollapsed, setIsRightCollapsed] = useAtom(rightPanelCollapsedAtom)
  const [lastExpandedRightPercent, setLastExpandedRightPercent] = useAtom(rightPanelLastExpandedSizeAtom)

  const toggleRightPanelCollapsed = useCallback(() => {
    setRightDragSizes(null)
    void setIsRightCollapsed(prev => {
        const willCollapse = !prev
        if (willCollapse) {
            void setRightSizes([100, 0])
        } else {
            const expanded = validatePanelPercentage(
              typeof lastExpandedRightPercent === 'number' ? lastExpandedRightPercent.toString() : null,
              30
            )
            void setRightSizes([100 - expanded, expanded])
        }
        return willCollapse
    })
  }, [setIsRightCollapsed, lastExpandedRightPercent, setRightSizes, setRightDragSizes])

  // Right panel drag state for performance optimization
  const [isDraggingRightSplit, setIsDraggingRightSplit] = useState(false)
  const rightSplitDraggingRef = useRef(false)

  // Keep left sizes sanitized and persisted if storage contained invalid data
  useEffect(() => {
    const sanitizedSizes = sanitizeSplitSizes(rawLeftPanelSizes, [20, 80])
    if (!areSizesEqual(sanitizedSizes, rawLeftPanelSizes as [number, number])) {
      void setLeftPanelSizes(sanitizedSizes)
    }
  }, [rawLeftPanelSizes, setLeftPanelSizes])

  useEffect(() => {
    const sanitizedLastExpanded = sanitizeSplitSizes(rawLeftPanelLastExpandedSizes, [20, 80])
    if (!areSizesEqual(sanitizedLastExpanded, rawLeftPanelLastExpandedSizes as [number, number])) {
      void setLeftPanelLastExpandedSizes(sanitizedLastExpanded)
    }
  }, [rawLeftPanelLastExpandedSizes, setLeftPanelLastExpandedSizes])

  // Memoized drag handlers for performance (following TerminalGrid pattern)
  const handleRightSplitDragStart = useCallback(() => {
    beginSplitDrag('app-right-panel', { orientation: 'col' })
    rightSplitDraggingRef.current = true
    setIsDraggingRightSplit(true)
    setRightDragSizes(null)
  }, [])

  const finalizeRightSplitDrag = useCallback((options?: { sizes?: number[] }) => {
    if (!rightSplitDraggingRef.current) return
    rightSplitDraggingRef.current = false
    
    setIsDraggingRightSplit(false)

    const commit = finalizeSplitCommit({
      dragSizes: rightDragSizes,
      nextSizes: options?.sizes,
      defaults: [70, 30],
      collapsed: false,
    })

    setRightDragSizes(null)

    if (commit) {
      if (!areSizesEqual(commit as [number, number], rightSizes as [number, number])) {
        void setRightSizes((): [number, number] => [commit[0], commit[1]])
      }
      if (commit[1] > 0 && commit[1] !== lastExpandedRightPercent) {
          void setLastExpandedRightPercent(commit[1])
      }
    }
    // Ensure we mark the panel expanded without overwriting the freshly committed sizes
    void setIsRightCollapsed(false)

    endSplitDrag('app-right-panel')
    window.dispatchEvent(new Event('right-panel-split-drag-end'))

    // Dispatch OpenCode resize event when right panel drag ends
    try {
      if (selection.kind === 'session' && selection.payload) {
        emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'session', sessionId: selection.payload })
      } else {
        emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'orchestrator' })
      }
    } catch (e) {
      logger.warn('[App] Failed to dispatch OpenCode resize event on right panel drag end', e)
    }

    try {
      if (selection.kind === 'session' && selection.payload) {
        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
      } else {
        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
      }
    } catch (e) {
      logger.warn('[App] Failed to dispatch generic terminal resize request on right panel drag end', e)
    }
  }, [
    selection,
    setRightSizes,
    setLastExpandedRightPercent,
    setIsRightCollapsed,
    rightDragSizes,
    rightSizes,
    lastExpandedRightPercent,
  ])

  const handleRightSplitDragEnd = useCallback((nextSizes: number[]) => {
    finalizeRightSplitDrag({ sizes: nextSizes })
  }, [finalizeRightSplitDrag])
  const handleRightSplitDrag = useCallback((nextSizes: number[]) => {
    setRightDragSizes(nextSizes)
  }, [])

  useEffect(() => {
    const handlePointerEnd = () => finalizeRightSplitDrag()
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handlePointerEnd)
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', handlePointerEnd)
    }
  }, [finalizeRightSplitDrag])

  useEffect(() => {
    return () => {
      if (rightSplitDraggingRef.current) {
        rightSplitDraggingRef.current = false
        endSplitDrag('app-right-panel')
      }
    }
  }, [])
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  // Helper function to handle session cancellation
  const handleCancelSession = useCallback(async () => {
    if (!currentSession) return

    const sessionName = currentSession.name
    beginSessionMutation(sessionName, 'remove')
    try {
      setIsCancelling(true)
      await invoke(TauriCommands.SchaltwerkCoreCancelSession, {
        name: sessionName
      })
      setCancelModalOpen(false)
    } catch (error) {
      logger.error('Failed to cancel session:', error)
      alert(`Failed to cancel session: ${error}`)
    } finally {
      endSessionMutation(sessionName, 'remove')
      setIsCancelling(false)
    }
  }, [beginSessionMutation, currentSession, endSessionMutation])

  // Handle CLI directory argument
  useEffect(() => {
    // Handle opening a Git repository
    const unlistenDirectoryPromise = listenEvent(SchaltEvent.OpenDirectory, async (directoryPath) => {
      logger.info('Received open-directory event:', directoryPath)
      await handleOpenProject(directoryPath)
    })

    // Handle opening home screen for non-Git directories
    const unlistenHomePromise = listenEvent(SchaltEvent.OpenHome, async (directoryPath) => {
      logger.info('Received open-home event for non-Git directory:', directoryPath)
      setShowHome(true)
      logger.info('Opened home screen because', directoryPath, 'is not a Git repository')
    })

    // Deterministically pull active project on mount to avoid event race
    void (async () => {
      try {
        const active = await invoke<string | null>(TauriCommands.GetActiveProjectPath)
        if (active) {
          logger.info('Detected active project on startup:', active)
          await handleOpenProject(active)
        }
      } catch (_e) {
        logger.warn('Failed to fetch active project on startup:', _e)
      }
    })()

    return () => {
      void unlistenDirectoryPromise.then(unlisten => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove directory event listener', error)
        }
      })
      void unlistenHomePromise.then(unlisten => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove home event listener', error)
        }
      })
    }
  }, [handleOpenProject])

  // Install smart dash/quote normalization for all text inputs (except terminals)
  useEffect(() => {
    installSmartDashGuards(document)
    logger.debug('[App] Smart dash normalization installed')
  }, [])

  useEffect(() => {
    const handlePermissionError = (detail: { error: string }) => {
      const error = detail?.error
      if (error?.includes('Permission required for folder:')) {
        // Extract the folder path from the error message
        const match = error.match(/Permission required for folder: ([^.]+)/)
        if (match && match[1]) {
          setPermissionDeniedPath(match[1])
        }
        setShowPermissionPrompt(true)
      }
    }

    const cleanup = listenUiEvent(UiEvent.PermissionError, handlePermissionError)

    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.SessionAction, (detail: SessionActionDetail) => {
      const { action, sessionId, sessionName, sessionDisplayName, branch, hasUncommittedChanges = false } = detail

      setCurrentSession({
        id: sessionId,
        name: sessionName,
        displayName: sessionDisplayName || sessionName,
        branch: branch || '',
        hasUncommittedChanges
      })

      if (action === 'cancel') {
        setCancelModalOpen(true)
      } else if (action === 'cancel-immediate') {
        setCancelModalOpen(false)
        void handleCancelSession()
      } else if (action === 'delete-spec') {
        setDeleteSpecModalOpen(true)
      }
    })

    return cleanup
  }, [handleCancelSession])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'

      if (!newSessionOpen && !cancelModalOpen && !isInputFocused && isShortcutForAction(e, KeyboardShortcutAction.NewSession, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        if (shouldBlockSessionModal('new session shortcut')) {
          return
        }
        logger.info('[App] New session shortcut triggered - opening new session modal (agent mode)')
        previousFocusRef.current = document.activeElement
        setOpenAsSpec(false)
        setNewSessionOpen(true)
        return
      }

      if (!newSessionOpen && !cancelModalOpen && !isInputFocused && isShortcutForAction(e, KeyboardShortcutAction.NewSpec, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        if (shouldBlockSessionModal('new spec shortcut')) {
          return
        }
        logger.info('[App] New spec shortcut triggered - opening new session modal (spec creation)')
        previousFocusRef.current = document.activeElement
        setOpenAsSpec(true)
        setNewSessionOpen(true)
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.IncreaseFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        increaseFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.DecreaseFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        decreaseFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.ResetFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        resetFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.OpenInApp, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        handleOpenInApp()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.ToggleLeftSidebar, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        toggleLeftPanelCollapsed()
        return
      }
    }

    const handleGlobalNewSession = () => {
      // Handle ⌘N from terminal (custom event)
      if (!newSessionOpen && !cancelModalOpen) {
        if (shouldBlockSessionModal('global new session shortcut')) {
          return
        }
        logger.info('[App] Global new session shortcut triggered (agent mode)')
        // Store current focus before opening modal
        previousFocusRef.current = document.activeElement
        setOpenAsSpec(false) // Explicitly set to false for global shortcut
        setNewSessionOpen(true)
      }
    }

    const handleOpenDiffView = () => {
      setDiffViewerState({ mode: 'session', filePath: null })
      setIsDiffViewerOpen(true)
    }

    const handleOpenInApp = () => {
      setTriggerOpenInApp(prev => prev + 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    const cleanupGlobalNewSession = listenUiEvent(UiEvent.GlobalNewSessionShortcut, () => handleGlobalNewSession())
    const cleanupOpenDiffView = listenUiEvent(UiEvent.OpenDiffView, () => handleOpenDiffView())
    const cleanupOpenDiffFile = listenUiEvent(UiEvent.OpenDiffFile, detail => {
      const filePath = detail?.filePath || null
      setDiffViewerState({ mode: 'session', filePath })
      setIsDiffViewerOpen(true)
    })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      cleanupGlobalNewSession()
      cleanupOpenDiffView()
      cleanupOpenDiffFile()
    }
  }, [newSessionOpen, cancelModalOpen, increaseFontSizes, decreaseFontSizes, resetFontSizes, keyboardShortcutConfig, platform, shouldBlockSessionModal])

  // Open NewSessionModal in spec creation mode when requested
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.NewSpecRequest, () => {
      if (shouldBlockSessionModal('new spec request event')) {
        return
      }
      logger.info('[App] schaltwerk:new-spec event received - opening modal for spec creation')
      previousFocusRef.current = document.activeElement
      setOpenAsSpec(true)
      setNewSessionOpen(true)
    })
    return cleanup
  }, [shouldBlockSessionModal])
  
  

  // Open NewSessionModal for new agent when requested
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.NewSessionRequest, () => {
      if (shouldBlockSessionModal('new session request event')) {
        return
      }
      logger.info('[App] schaltwerk:new-session event received - opening modal in agent mode')
      previousFocusRef.current = document.activeElement
      setOpenAsSpec(false)
      setNewSessionOpen(true)
    })
    return cleanup
  }, [shouldBlockSessionModal])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenSettings, detail => {
      setSettingsInitialTab(detail?.tab)
      setSettingsOpen(true)
    })
    return cleanup
  }, [])

  // Open Start Agent modal prefilled from an existing spec
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.StartAgentFromSpec, (detail?: StartAgentFromSpecDetail) => {
      logger.info('[App] Received start-agent-from-spec event:', detail)
      const name = detail?.name
      if (!name) {
        logger.warn('[App] No name provided in start-agent-from-spec event')
        return
      }

      if (shouldBlockSessionModal('start-agent-from-spec event')) {
        return
      }

      // Store focus and open modal
      previousFocusRef.current = document.activeElement

      // Notify modal that prefill is coming
      emitUiEvent(UiEvent.NewSessionPrefillPending)

      // Fetch spec content first, then open modal with prefilled data
      logger.info('[App] Fetching session data for prefill:', name)
      void (async () => {
        try {
          const prefillData = await fetchSessionForPrefill(name)
          logger.info('[App] Fetched prefill data:', prefillData)

          // Open modal after data is ready
          setNewSessionOpen(true)
          setStartFromSpecName(name)

          // Dispatch prefill event with fetched data
          if (prefillData) {
            // Use requestAnimationFrame to ensure modal is rendered before dispatching
            requestAnimationFrame(() => {
              logger.info('[App] Dispatching prefill event with data')
              emitUiEvent(UiEvent.NewSessionPrefill, prefillData)
            })
          } else {
            logger.warn('[App] No prefill data fetched for session:', name)
          }
        } catch (error) {
          logger.error('[App] Failed to prefill start-agent-from-spec modal', error)
        }
      })()
    })
    return cleanup
  }, [fetchSessionForPrefill, shouldBlockSessionModal])


  const handleDeleteSpec = async () => {
    if (!currentSession) return

    const sessionName = currentSession.name
    beginSessionMutation(sessionName, 'remove')
    try {
      setIsCancelling(true)
      await invoke(TauriCommands.SchaltwerkCoreArchiveSpecSession, { name: sessionName })
      setDeleteSpecModalOpen(false)
      // No manual selection here; SessionRemoved + SessionsRefreshed will drive next focus
    } catch (error) {
      logger.error('Failed to delete spec:', error)
      alert(`Failed to delete spec: ${error}`)
    } finally {
      endSessionMutation(sessionName, 'remove')
      setIsCancelling(false)
    }
  }

  const handleOpenHistoryDiff = useCallback((payload: { repoPath: string; commit: HistoryItem; files: CommitFileChange[]; initialFilePath?: string | null }) => {
    const { repoPath, commit, files, initialFilePath } = payload
    const committedAt = Number.isFinite(commit.timestamp)
      ? new Date(commit.timestamp).toLocaleString()
      : undefined

    const historyContext: HistoryDiffContext = {
      repoPath,
      commitHash: commit.fullHash ?? commit.id,
      subject: commit.subject,
      author: commit.author,
      committedAt,
      files,
    }

    setDiffViewerState({ mode: 'history', filePath: initialFilePath ?? null, historyContext })
    setIsDiffViewerOpen(true)
  }, [])

  const handleCloseDiffViewer = () => {
    setIsDiffViewerOpen(false)
    setDiffViewerState(null)
  }

  // Helper function to create terminals for a session (avoids code duplication)
  const createTerminalsForSession = async (sessionName: string) => {
    try {
      // Get session data to get correct worktree path
      const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
      const worktreePath = sessionData.worktree_path
      
      // Create terminals for this session using consistent naming pattern
      const topTerminalId = stableSessionTerminalId(sessionName, 'top')
      
      // Create only the top terminal. Bottom terminals are tabbed and created by TerminalTabs as needed (-bottom-0)
      await createTerminalBackend({ id: topTerminalId, cwd: worktreePath })
    } catch (_e) {
      logger.warn(`[App] Failed to create terminals for session ${sessionName}:`, _e)
    }
  }


  const handleCreateSession = async (data: {
    name: string
    prompt?: string
    baseBranch: string
    customBranch?: string
    userEditedName?: boolean
    isSpec?: boolean
    draftContent?: string
    versionCount?: number
    agentType?: string
    skipPermissions?: boolean
    agentTypes?: string[]
  }) => {
    try {
      await preserveSelection(async () => {
        // If starting from an existing spec via the modal, convert that spec to active
        if (!data.isSpec && startFromDraftName && startFromDraftName === data.name) {
          // Ensure the spec content reflects latest prompt before starting
          const contentToUse = data.prompt || ''
          if (contentToUse.trim().length > 0) {
            await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
              name: data.name,
              content: contentToUse,
            })
          }

          // Handle multiple versions like new session creation
          const useAgentTypes = Boolean(data.agentTypes && data.agentTypes.length > 0)
          const count = useAgentTypes ? (data.agentTypes?.length ?? 1) : Math.max(1, Math.min(4, data.versionCount ?? 1))
          let firstSessionName = data.name

          const overallSpecStart = performance.now()
          logger.info('[SpecStart] Starting agent promotion from spec', {
            specName: data.name,
            count,
            baseBranch: data.baseBranch,
            agentType: data.agentType,
            agentTypes: data.agentTypes,
          })

          // Create array of desired session names and process them
          const desiredSessionNames = Array.from({ length: count }, (_, i) =>
            i === 0 ? data.name : `${data.name}_v${i + 1}`
          )

          // Generate a stable group id for these versions
          const versionGroupId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
            ? (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID()
            : `${data.name}-${Date.now()}`
          const sessionPromotionStartTimes = new Map<string, number>()
          const realizedSessionNames: string[] = []

          for (const [index, desiredName] of desiredSessionNames.entries()) {
            const agentTypeForVersion = useAgentTypes ? (data.agentTypes?.[index] ?? null) : (data.agentType || null)
            const promotionStart = performance.now()
            sessionPromotionStartTimes.set(desiredName, promotionStart)
            logger.info('[SpecStart] Enqueue pending startup', {
              sessionName: desiredName,
              agentType: agentTypeForVersion ?? 'default',
              versionIndex: index + 1,
            })

            const createdSessionName = await waitForSessionsRefreshed(async () => {
              if (index === 0) {
                const created = await invoke<RawSession>(TauriCommands.SchaltwerkCoreStartSpecSession, {
                  name: desiredName,
                  baseBranch: data.baseBranch || null,
                  versionGroupId,
                  versionNumber: index + 1,
                  agentType: agentTypeForVersion,
                  skipPermissions: data.skipPermissions ?? null,
                })
                return created.name
              }

              const created = await invoke<RawSession>(TauriCommands.SchaltwerkCoreCreateAndStartSpecSession, {
                name: desiredName,
                specContent: contentToUse,
                baseBranch: data.baseBranch || null,
                versionGroupId,
                versionNumber: index + 1,
                agentType: agentTypeForVersion,
                skipPermissions: data.skipPermissions ?? null,
              })
              return created.name
            })

            realizedSessionNames.push(createdSessionName)
            sessionPromotionStartTimes.delete(desiredName)
            sessionPromotionStartTimes.set(createdSessionName, promotionStart)
            expectSession(createdSessionName)

            await enqueuePendingStartup(createdSessionName, agentTypeForVersion ?? undefined)

            if (index === 0) {
              logger.info('[SpecStart] StartSpecSession completed', {
                sessionName: createdSessionName,
                elapsedMs: Math.round(performance.now() - promotionStart),
              })
            } else {
              logger.info('[SpecStart] CreateAndStartSpecSession completed', {
                sessionName: createdSessionName,
                elapsedMs: Math.round(performance.now() - promotionStart),
              })
            }
          }

          setNewSessionOpen(false)
          setStartFromSpecName(null)
          setCachedPrompt('')

          // Dispatch event for other components to know a session was created from spec
          const primarySessionName = realizedSessionNames[0] || firstSessionName
          emitUiEvent(UiEvent.SessionCreated, { name: primarySessionName })

          const ensureTerminalStart = performance.now()
          // Agents are already running because StartSpecSession/CreateAndStartSpecSession start them.
          // Only ensure terminals exist, do not start again to avoid duplicate agent processes.
          try {
            for (const sessionName of realizedSessionNames) {
              await createTerminalsForSession(sessionName)
            }
            logger.info('[SpecStart] Terminal ensure completed', {
              sessionNames: realizedSessionNames,
              elapsedMs: Math.round(performance.now() - ensureTerminalStart),
            })
          } catch (e) {
            logger.warn('[App] Failed to ensure terminals for spec-derived sessions:', e)
          }

          const totalElapsedMs = Math.round(performance.now() - overallSpecStart)
          logger.info('[SpecStart] Completed spec agent promotion', {
            sessions: realizedSessionNames,
            totalElapsedMs,
            durations: realizedSessionNames.reduce<Record<string, number | undefined>>((acc, name) => {
              const start = sessionPromotionStartTimes.get(name)
              acc[name] = start ? Math.round(ensureTerminalStart - start) : undefined
              return acc
            }, {}),
          })

          // Don't automatically switch focus when starting spec sessions
          // The user should remain focused on their current session
          return
        }

        if (data.isSpec) {
          // Create spec session
          await invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, {
            name: data.name,
            specContent: data.draftContent || '',
            agentType: data.agentType,
            skipPermissions: data.skipPermissions,
          })
          setNewSessionOpen(false)
          setCachedPrompt('')

          // Dispatch event for other components to know a spec was created
          emitUiEvent(UiEvent.SpecCreated, { name: data.name })
        } else {
          // Create one or multiple sessions depending on versionCount or agentTypes
          const useAgentTypes = Boolean(data.agentTypes && data.agentTypes.length > 0)
          const count = useAgentTypes ? (data.agentTypes?.length ?? 1) : Math.max(1, Math.min(4, data.versionCount ?? 1))

          logger.info('[App] Creating sessions with multi-agent data:', {
            useAgentTypes,
            agentTypes: data.agentTypes,
            agentType: data.agentType,
            count,
            versionCount: data.versionCount
          })

          // When creating multiple versions, ensure consistent naming with _v1, _v2, etc.
          const baseName = data.name
          // Consider it auto-generated if the user didn't manually edit the name
          const isAutoGenerated = !data.userEditedName

          // Create all versions first
          const createdSessions: Array<{ name: string; agentType: string | null | undefined }> = []
          // Generate a stable group id for DB linkage
          const versionGroupId = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID() : `${baseName}-${Date.now()}`
          for (let i = 1; i <= count; i++) {
            // First version uses base name, additional versions get _v2, _v3, etc.
            const versionName = i === 1 ? baseName : `${baseName}_v${i}`
            const agentTypeForVersion = useAgentTypes ? (data.agentTypes?.[i - 1] ?? null) : data.agentType

            logger.info(`[App] Creating version ${i}/${count}:`, {
              versionName,
              agentTypeForVersion,
              fromArray: useAgentTypes,
              arrayIndex: i - 1,
              arrayValue: data.agentTypes?.[i - 1]
            })

            if (!data.isSpec) {
              try {
                await enqueuePendingStartup(versionName, agentTypeForVersion ?? undefined)
              } catch (enqueueError) {
                logger.warn('[App] Failed to enqueue pending startup before creation:', enqueueError)
              }
            }

            // For single sessions, use userEditedName flag as provided
            // For multiple versions, don't mark as user-edited so they can be renamed as a group
            const createdSession = await invoke<RawSession | null>(TauriCommands.SchaltwerkCoreCreateSession, {
              name: versionName,
              prompt: data.prompt || null,
              baseBranch: data.baseBranch || null,
              customBranch: data.customBranch || null,
              userEditedName: count > 1 ? false : (data.userEditedName ?? false),
              versionGroupId,
              versionNumber: i,
              agentType: agentTypeForVersion,
              skipPermissions: data.skipPermissions,
            })

            const actualSessionName = createdSession?.name ?? versionName
            createdSessions.push({ name: actualSessionName, agentType: agentTypeForVersion })
            expectSession(actualSessionName)

            if (!data.isSpec && actualSessionName !== versionName) {
              try {
                await enqueuePendingStartup(actualSessionName, agentTypeForVersion ?? undefined)
              } catch (enqueueError) {
                logger.warn('[App] Failed to enqueue pending startup after name normalization:', enqueueError)
              }
            }
          }

          const actualNamesForLog = createdSessions.map(session => session.name)
          logger.info(`[App] Created ${count} sessions: ${actualNamesForLog.join(', ')}`)
          
          // If we created multiple versions with an auto-generated base name, trigger group rename
          // This needs to happen after a delay to ensure sessions are created
          if (count > 1 && isAutoGenerated && data.prompt) {
            setTimeout(() => {
              void (async () => {
                try {
                  logger.info(`[App] Attempting to rename version group with baseName: '${baseName}' and prompt: '${data.prompt}'`)
                  await invoke(TauriCommands.SchaltwerkCoreRenameVersionGroup, {
                    baseName,
                    prompt: data.prompt,
                    baseBranch: data.baseBranch || null,
                    versionGroupId,
                  })
                  logger.info(`[App] Successfully renamed version group: '${baseName}'`)
                } catch (err) {
                  logger.error('Failed to rename version group:', err)
                }
              })()
            }, 1000)
          }

          setNewSessionOpen(false)
          setCachedPrompt('')

          // Don't automatically switch focus when creating new sessions
          // The user should remain focused on their current session
          
          // Dispatch event for other components to know a session was created
          const firstCreatedName = createdSessions[0]?.name ?? data.name
          emitUiEvent(UiEvent.SessionCreated, { name: firstCreatedName })

        }
      })
    } catch (error) {
      logger.error('Failed to create session:', error)
      alert(`Failed to create session: ${error}`)
    }
  }


  const handleGoHome = useCallback(() => {
    setShowHome(true)
    clearPendingPath()
    void deactivateProject()
  }, [deactivateProject, clearPendingPath])

  const handleSelectTab = useCallback(async (path: string): Promise<boolean> => {
    if (!path) {
      return false
    }

    const hasCompetingSwitch = Boolean(
      projectSwitchStatus?.inFlight &&
      projectSwitchStatus.target &&
      projectSwitchStatus.target !== path
    )

    if (path === projectPath && !hasCompetingSwitch) {
      clearPendingPath(path)
      setShowHome(false)
      return true
    }

    if (pendingActivePathRef.current === path) {
      setShowHome(false)
      return true
    }

    pendingActivePathRef.current = path
    setPendingActivePath(path)
    setShowHome(false)

    try {
      const switched = await selectProject({ path })
      if (!switched && projectPath !== path) {
        clearPendingPath(path)
      }
      return switched
    } catch (error) {
      logger.error('Failed to switch project:', error)
      clearPendingPath(path)
      return false
    }
  }, [selectProject, projectPath, clearPendingPath, projectSwitchStatus])

  const handleCloseTab = useCallback(async (path: string) => {
    try {
      const result = await closeProject({ path })
      if (!result.closed) {
        logger.warn('Aborting tab close because backend rejected the request')
        return
      }

      setAttentionCounts(prev => {
        if (!(path in prev)) {
          return prev
        }
        const { [path]: _removed, ...rest } = prev
        return rest
      })

      setShowHome(result.nextActivePath === null)
    } catch (error) {
      logger.warn('Failed to cleanup closed project:', error)
    }
  }, [closeProject])

  const switchProject = useCallback(async (direction: 'prev' | 'next') => {
    if (projectTabs.length <= 1) return
    if (!projectPath) return

    const currentIndex = projectTabs.findIndex(tab => tab.projectPath === projectPath)
    if (currentIndex === -1) return

    let newIndex = currentIndex
    if (direction === 'next') {
      newIndex = Math.min(currentIndex + 1, projectTabs.length - 1)
    } else {
      newIndex = Math.max(currentIndex - 1, 0)
    }

    if (newIndex !== currentIndex) {
      const targetTab = projectTabs[newIndex]
      if (targetTab?.projectPath) {
        await handleSelectTab(targetTab.projectPath)
      }
    }
  }, [projectTabs, projectPath, handleSelectTab])

  const handleSelectPrevProject = useCallback(() => {
    void switchProject('prev')
  }, [switchProject])

  const handleSelectNextProject = useCallback(() => {
    void switchProject('next')
  }, [switchProject])

  const tabsWithAttention = useMemo(() => projectTabs.map(tab => ({
    ...tab,
    attentionCount: attentionCounts[tab.projectPath] ?? 0
  })), [projectTabs, attentionCounts])

  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  )
  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const collapsedLeftPanelSizes = useMemo(() => {
    const safeWidth = Math.max(windowWidth, COLLAPSED_LEFT_PANEL_PX + 400)
    const pct = Math.min(40, (COLLAPSED_LEFT_PANEL_PX / safeWidth) * 100)
    return [pct, 100 - pct]
  }, [windowWidth])

  const activeTabPath = showHome ? null : (pendingActivePath ?? projectPath)

  // Update unified work area ring color when selection changes
  useEffect(() => {
    const el = document.getElementById('work-ring')
    if (!el) return
    // Remove the ring entirely - no visual indicator needed
    el.style.boxShadow = 'none'
  }, [selection])

  if (showHome && projectTabs.length === 0) {
    return (
      <>
        <TopBar
          tabs={[]}
          activeTabPath={null}
          onGoHome={() => {}}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onOpenSettings={() => {
            setSettingsInitialTab(undefined)
            setSettingsOpen(true)
          }}
        />
        <div className="pt-[32px] h-full">
          <HomeScreen onOpenProject={(path) => { void handleOpenProject(path) }} />
        </div>
        <SettingsModal
          open={settingsOpen}
          initialTab={settingsInitialTab}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsInitialTab(undefined)
          }}
        />
      </>
    )
  }

  return (
    <ErrorBoundary name="App">
      {/* Show TopBar always */}
      <TopBar
        tabs={tabsWithAttention}
        activeTabPath={activeTabPath}
        onGoHome={handleGoHome}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenSettings={() => {
          setSettingsInitialTab(undefined)
          setSettingsOpen(true)
        }}
        onOpenProjectSelector={() => setProjectSelectorOpen(true)}
        resolveOpenPath={async () => resolveOpenPathForOpenButton({
          selection,
          activeTabPath,
          projectPath,
          invoke
        })}
        isRightPanelCollapsed={isRightCollapsed}
        onToggleRightPanel={toggleRightPanelCollapsed}
        triggerOpenCounter={triggerOpenInApp}
      />

      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <div className="pt-[32px] h-full">
          <ErrorBoundary name="HomeScreen">
            <HomeScreen onOpenProject={(path) => { void handleOpenProject(path) }} />
          </ErrorBoundary>
        </div>
      )}

      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
        <>
          <div className="pt-[32px] h-full flex flex-col w-full">
            <div className="flex-1 min-h-0">
              <Split
                className="h-full w-full flex"
                sizes={isLeftPanelCollapsed ? collapsedLeftPanelSizes : leftRenderSizes}
                minSize={[isLeftPanelCollapsed ? COLLAPSED_LEFT_PANEL_PX : 240, 400]}
                gutterSize={isLeftPanelCollapsed ? 0 : SPLIT_GUTTER_SIZE}
                onDragStart={handleLeftSplitDragStart}
                onDrag={handleLeftSplitDrag}
                onDragEnd={handleLeftSplitDragEnd}
              >
                <div
                  className="h-full border-r overflow-y-auto shrink-0"
                  style={{
                    backgroundColor: theme.colors.background.secondary,
                    borderRightColor: theme.colors.border.default,
                    minWidth: isLeftPanelCollapsed ? `${COLLAPSED_LEFT_PANEL_PX}px` : undefined,
                    maxWidth: isLeftPanelCollapsed ? `${COLLAPSED_LEFT_PANEL_PX}px` : undefined,
                  }}
                  data-testid="sidebar"
                >
                  <div className="h-full flex flex-col min-h-0">
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <SessionErrorBoundary>
                        <Sidebar 
                          isDiffViewerOpen={isDiffViewerOpen}
                          openTabs={projectTabs}
                          onSelectPrevProject={handleSelectPrevProject}
                          onSelectNextProject={handleSelectNextProject}
                          isCollapsed={isLeftPanelCollapsed}
                          onExpandRequest={toggleLeftPanelCollapsed}
                          onToggleSidebar={toggleLeftPanelCollapsed}
                        />
                      </SessionErrorBoundary>
                    </div>
                    {!isLeftPanelCollapsed && (
                    <div
                      className="p-2 border-t"
                      style={{ borderTopColor: theme.colors.border.default }}
                    >
                      <div
                        className="flex items-center justify-between px-1 pb-2 text-[11px]"
                        style={{ color: theme.colors.text.muted, fontSize: theme.fontSize.caption }}
                        aria-hidden="true"
                      >
                        <span className="flex items-center gap-2">
                          <span>Navigate sessions</span>
                          <span style={{ color: theme.colors.text.secondary }}>⌘↑ · ⌘↓</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span>Cycle filters</span>
                          <span style={{ color: theme.colors.text.secondary }}>⌘← · ⌘→</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            previousFocusRef.current = document.activeElement
                            setNewSessionOpen(true)
                          }}
                          className="w-full text-sm px-3 py-2 rounded group transition-colors flex items-center justify-between border"
                          style={{
                            backgroundColor: `${theme.colors.background.elevated}99`,
                            color: theme.colors.text.primary,
                            borderColor: theme.colors.border.subtle
                          }}
                          data-onboarding="start-agent-button"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = `${theme.colors.background.hover}99`
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = `${theme.colors.background.elevated}99`
                          }}
                          title={`Start agent (${startShortcut})`}
                        >
                          <span>Start Agent</span>
                          <span
                            className="text-xs px-2 py-0.5 rounded transition-opacity group-hover:opacity-100"
                            style={{
                              backgroundColor: theme.colors.background.secondary,
                              color: theme.colors.text.secondary
                            }}
                          >
                            {startShortcut}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            previousFocusRef.current = document.activeElement
                            setOpenAsSpec(true)
                            setNewSessionOpen(true)
                          }}
                          className="w-full text-sm px-3 py-2 rounded group border transition-colors flex items-center justify-between"
                          style={{
                            backgroundColor: theme.colors.accent.amber.bg,
                            borderColor: theme.colors.accent.amber.border,
                            color: theme.colors.text.primary
                          }}
                          data-onboarding="create-spec-button"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = `${theme.colors.accent.amber.DEFAULT}33`
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = theme.colors.accent.amber.bg
                          }}
                          title={`Create spec (${specShortcut})`}
                        >
                          <span>Create Spec</span>
                          <span
                            className="text-xs px-2 py-0.5 rounded transition-opacity group-hover:opacity-100"
                            style={{
                              backgroundColor: withOpacity(theme.colors.accent.amber.DEFAULT, 0.15),
                              color: theme.colors.accent.amber.light
                            }}
                          >
                          {specShortcut}
                          </span>
                        </button>
                      </div>
                    </div>
                    )}
                  </div>
                </div>

                <div className="relative h-full">
                  {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
                  <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
                  {isRightCollapsed ? (
                    // When collapsed, render only the terminal grid at full width
                    <main className="h-full w-full" style={{ backgroundColor: theme.colors.background.primary }} data-testid="terminal-grid">
                      <ErrorBoundary name="TerminalGrid">
                        <TerminalGrid />
                      </ErrorBoundary>
                    </main>
                  ) : (
                    // When expanded, render the split view
                      <Split 
                      className="h-full w-full flex" 
                      sizes={rightRenderSizes} 
                      minSize={[400, 280]} 
                      gutterSize={SPLIT_GUTTER_SIZE}
                      onDragStart={handleRightSplitDragStart}
                      onDrag={handleRightSplitDrag}
                      onDragEnd={handleRightSplitDragEnd}
                    >
                      <main className="h-full" style={{ backgroundColor: theme.colors.background.primary }} data-testid="terminal-grid">
                        <ErrorBoundary name="TerminalGrid">
                          <TerminalGrid />
                        </ErrorBoundary>
                      </main>
                      <section className={`overflow-hidden`}>
                        <ErrorBoundary name="RightPanel">
                          <RightPanelTabs 
                            onOpenHistoryDiff={handleOpenHistoryDiff}
                            isDragging={isDraggingRightSplit}
                          />
                        </ErrorBoundary>
                      </section>
                    </Split>
                  )}
                </div>
              </Split>
            </div>
          </div>

           <NewSessionModal
             open={newSessionOpen}
             initialIsDraft={openAsDraft}
             cachedPrompt={cachedPrompt}
             onPromptChange={setCachedPrompt}
             onClose={() => {
               logger.info('[App] NewSessionModal closing - resetting state')
               setNewSessionOpen(false)
               setOpenAsSpec(false) // Always reset to false when closing
               setStartFromSpecName(null)
               // Restore focus after modal closes
               if (previousFocusRef.current && previousFocusRef.current instanceof HTMLElement) {
                 setTimeout(() => {
                   try {
                     (previousFocusRef.current as HTMLElement).focus()
                   } catch (error) {
                     logger.warn('[App] Failed to restore focus after NewSessionModal closed:', error)
                   }
                 }, 100)
               }
             }}
             onCreate={handleCreateSession}
           />

          {currentSession && (
            <>
              <CancelConfirmation
                open={cancelModalOpen}
                displayName={currentSession.displayName}
                branch={currentSession.branch}
                hasUncommittedChanges={currentSession.hasUncommittedChanges}
                onConfirm={() => { void handleCancelSession() }}
                onCancel={() => setCancelModalOpen(false)}
                loading={isCancelling}
              />
               <DeleteSpecConfirmation
                 open={deleteSpecModalOpen}
                 displayName={currentSession.displayName}
                 onConfirm={() => { void handleDeleteSpec() }}
                 onCancel={() => setDeleteSpecModalOpen(false)}
                 loading={isCancelling}
               />
            </>
          )}

          {/* Diff Viewer Modal with Review - render only when open */}
          {isDiffViewerOpen && diffViewerState && (
            <UnifiedDiffModal
              filePath={diffViewerState.filePath}
              isOpen={true}
              onClose={handleCloseDiffViewer}
              mode={diffViewerState.mode}
              historyContext={diffViewerState.mode === 'history' ? diffViewerState.historyContext : undefined}
            />
          )}
          
          <AgentCliMissingModal
            open={showCliMissingModal}
            loading={agentDetectLoading}
            statusByAgent={agentStatusByName}
            onRefresh={() => { void refreshAgentDetection() }}
            onOpenSettings={() => emitUiEvent(UiEvent.OpenSettings, { tab: 'environment' })}
            onClose={() => setShowCliMissingModal(false)}
          />

          {/* Settings Modal */}
          <SettingsModal
            open={settingsOpen}
            initialTab={settingsInitialTab}
            onClose={() => {
              setSettingsOpen(false)
              setSettingsInitialTab(undefined)
            }}
            onOpenTutorial={openOnboarding}
          />

          {/* Project Selector Modal */}
          <ProjectSelectorModal
            open={projectSelectorOpen}
            onClose={() => setProjectSelectorOpen(false)}
            onOpenProject={(path) => { void handleOpenProject(path) }}
            openProjectPaths={projectTabs.map(tab => tab.projectPath)}
          />

          <OnboardingModal
            open={isOnboardingOpen}
            onClose={closeOnboarding}
            onComplete={() => { void completeOnboarding() }}
          />

          {/* Permission Prompt - shows only when needed */}
          {showPermissionPrompt && (
            <PermissionPrompt
              showOnlyIfNeeded={true}
              folderPath={permissionDeniedPath || undefined}
              onPermissionGranted={() => {
                logger.info(`Folder permission granted for: ${permissionDeniedPath}`)
                setShowPermissionPrompt(false)
                setPermissionDeniedPath(null)
              }}
              onRetryAgent={() => {
                emitUiEvent(UiEvent.RetryAgentStart)
                setShowPermissionPrompt(false)
                setPermissionDeniedPath(null)
              }}
            />
          )}
        </>
      )}
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <GithubIntegrationProvider>
      <AppContent />
    </GithubIntegrationProvider>
  )
}
