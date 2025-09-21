import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { SchaltEvent, listenEvent } from './common/eventSystem'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import ErrorBoundary from './components/ErrorBoundary'
import SessionErrorBoundary from './components/SessionErrorBoundary'
import { UnifiedDiffModal } from './components/diff/UnifiedDiffModal'
import Split from 'react-split'
import { NewSessionModal } from './components/modals/NewSessionModal'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { DeleteSpecConfirmation } from './components/modals/DeleteSpecConfirmation'
import { SettingsModal } from './components/modals/SettingsModal'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './contexts/SelectionContext'
import { clearTerminalStartedTracking } from './components/terminal/Terminal'
import { useProject } from './contexts/ProjectContext'
import { useFontSize } from './contexts/FontSizeContext'
import { HomeScreen } from './components/home/HomeScreen'
import { ProjectTab, determineNextActiveTab } from './common/projectTabs'
import { TopBar } from './components/TopBar'
import { PermissionPrompt } from './components/PermissionPrompt'
import { OnboardingModal } from './components/onboarding/OnboardingModal'
import { useOnboarding } from './hooks/useOnboarding'
import { useSessionPrefill } from './hooks/useSessionPrefill'
import { useRightPanelPersistence } from './hooks/useRightPanelPersistence'
import { theme } from './common/theme'
import { resolveOpenPathForOpenButton } from './utils/resolveOpenPath'
import { waitForSessionsRefreshed } from './utils/waitForSessionsRefreshed'
import { TauriCommands } from './common/tauriCommands'
import { UiEvent, listenUiEvent, markBackgroundStart } from './common/uiEvents'
import { logger } from './utils/logger'
import { installSmartDashGuards } from './utils/normalizeCliText'
import { useKeyboardShortcutsConfig } from './contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from './keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from './keyboardShortcuts/helpers'
import { useSelectionPreserver } from './hooks/useSelectionPreserver'



export interface SessionActionEvent {\n  attachedImages?: string[];\n
  action: 'cancel' | 'cancel-immediate'
  sessionId: string
  sessionName: string
  sessionDisplayName?: string
  branch?: string
  hasUncommittedChanges?: boolean
}


// Helper function to get the basename of a path (last segment)
function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export default function App() {
  const { selection, clearTerminalTracking } = useSelection()
  const { projectPath, setProjectPath } = useProject()
  const { increaseFontSizes, decreaseFontSizes, resetFontSizes } = useFontSize()
  const { isOnboardingOpen, completeOnboarding, closeOnboarding, openOnboarding } = useOnboarding()
  const { fetchSessionForPrefill } = useSessionPrefill()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [deleteSpecModalOpen, setDeleteSpecModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [openTabs, setOpenTabs] = useState<ProjectTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [startFromDraftName, setStartFromSpecName] = useState<string | null>(null)
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)
  const [openAsDraft, setOpenAsSpec] = useState(false)
  const projectSwitchPromiseRef = useRef<Promise<boolean> | null>(null)
  const projectSwitchAbortControllerRef = useRef<AbortController | null>(null)
  const projectSwitchTargetRef = useRef<string | null>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const preserveSelection = useSelectionPreserver()

  const rightPanelStorageKey = selection
    ? selection.kind === 'orchestrator'
      ? 'orchestrator'
      : selection.payload || 'unknown'
    : 'default'

  const {
    sizes: rightSizes,
    setSizes: setRightSizes,
    isCollapsed: isRightCollapsed,
    toggleCollapsed: toggleRightPanelCollapsed,
    setCollapsedExplicit: setRightPanelCollapsedExplicit
  } = useRightPanelPersistence({ storageKey: rightPanelStorageKey })
  
  // Right panel drag state for performance optimization
  const [isDraggingRightSplit, setIsDraggingRightSplit] = useState(false)

  // Memoized drag handlers for performance (following TerminalGrid pattern)
  const handleRightSplitDragStart = useCallback(() => {
    document.body.classList.add('is-split-dragging')
    setIsDraggingRightSplit(true)
  }, [])

  const handleRightSplitDragEnd = useCallback((nextSizes: number[]) => {
    setRightSizes((): [number, number] => [nextSizes[0], nextSizes[1]])
    setRightPanelCollapsedExplicit(false)
    document.body.classList.remove('is-split-dragging')
    window.dispatchEvent(new Event('right-panel-split-drag-end'))
    setIsDraggingRightSplit(false)
  }, [setRightPanelCollapsedExplicit, setRightSizes])
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  // Helper function to handle session cancellation
  const handleCancelSession = useCallback(async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke(TauriCommands.SchaltwerkCoreCancelSession, {
        name: currentSession.name
      })
      setCancelModalOpen(false)

    } catch (error) {
      logger.error('Failed to cancel session:', error)
      alert(`Failed to cancel session: ${error}`)
    } finally {
      setIsCancelling(false)
    }
  }, [currentSession])

  // Local helper to apply project activation consistently
  const applyActiveProject = useCallback(async (path: string, options: { initializeBackend?: boolean } = {}) => {
    const { initializeBackend = true } = options

    try {
      if (initializeBackend) {
        await invoke(TauriCommands.InitializeProject, { path })
        await invoke(TauriCommands.AddRecentProject, { path })
      }

      setProjectPath(path)
      setShowHome(false)

      const basename = getBasename(path)
      setOpenTabs(prev => {
        const exists = prev.some(tab => tab.projectPath === path)
        if (!exists) {
          return [...prev, { projectPath: path, projectName: basename }]
        }
        return prev
      })
      setActiveTabPath(path)

      logger.info('Activated project:', path)

      // If repository has no commits, trigger New Project flow
      try {
        const isEmpty = await invoke<boolean>(TauriCommands.RepositoryIsEmpty)
        if (isEmpty) {
          setShowHome(true)
          window.dispatchEvent(new CustomEvent('schaltwerk:open-new-project-dialog'))
        }
      } catch (_e) {
        logger.warn('Failed to check if repository is empty:', _e)
      }
    } catch (error) {
      logger.error('Failed to activate project:', error)
    }
  }, [setProjectPath, setShowHome, setOpenTabs, setActiveTabPath])

  // Handle CLI directory argument
  useEffect(() => {
    // Handle opening a Git repository
    const unlistenDirectoryPromise = listenEvent(SchaltEvent.OpenDirectory, async (directoryPath) => {
      logger.info('Received open-directory event:', directoryPath)
      await applyActiveProject(directoryPath, { initializeBackend: true })
    })

    // Handle opening home screen for non-Git directories
    const unlistenHomePromise = listenEvent(SchaltEvent.OpenHome, async (directoryPath) => {
      logger.info('Received open-home event for non-Git directory:', directoryPath)
      setShowHome(true)
      logger.info('Opened home screen because', directoryPath, 'is not a Git repository')
    })

    // Deterministically pull active project on mount to avoid event race
    ;(async () => {
      try {
        const active = await invoke<string | null>(TauriCommands.GetActiveProjectPath)
        if (active) {
          logger.info('Detected active project on startup:', active)
          // Backend already set the project; only sync UI state
          await applyActiveProject(active, { initializeBackend: false })
        }
      } catch (_e) {
        logger.warn('Failed to fetch active project on startup:', _e)
      }
    })()

     return () => {
      unlistenDirectoryPromise.then(unlisten => unlisten())
      unlistenHomePromise.then(unlisten => unlisten())
    }
  }, [applyActiveProject, setProjectPath])

  // Install smart dash/quote normalization for all text inputs (except terminals)
  useEffect(() => {
    installSmartDashGuards(document)
    logger.debug('[App] Smart dash normalization installed')
  }, [])

  useEffect(() => {
    const unlisten = listenUiEvent(UiEvent.PermissionError, ({ error }) => {
      if (error?.includes('Permission required for folder:')) {
        const match = error.match(/Permission required for folder: ([^.]+)/)
        if (match && match[1]) {
          setPermissionDeniedPath(match[1])
        }
        setShowPermissionPrompt(true)
      }
    })
    return () => { unlisten() }
  }, [])

  useEffect(() => {
    const handleSessionAction = (event: CustomEvent<SessionActionEvent>) => {
      const { action, sessionId, sessionName, sessionDisplayName, branch, hasUncommittedChanges = false } = event.detail

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
        // perform cancel directly
        setCancelModalOpen(false)
        void handleCancelSession()
      } else if (action === 'delete-spec') {
        setDeleteSpecModalOpen(true)
      }
    }

    window.addEventListener('schaltwerk:session-action', handleSessionAction as EventListener)
    return () => window.removeEventListener('schaltwerk:session-action', handleSessionAction as EventListener)
  }, [handleCancelSession])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'

      if (!newSessionOpen && !cancelModalOpen && !isInputFocused && isShortcutForAction(e, KeyboardShortcutAction.NewSession, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        logger.info('[App] New session shortcut triggered - opening new session modal (agent mode)')
        previousFocusRef.current = document.activeElement
        setOpenAsSpec(false)
        setNewSessionOpen(true)
        return
      }

      if (!newSessionOpen && !cancelModalOpen && !isInputFocused && isShortcutForAction(e, KeyboardShortcutAction.NewSpec, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
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
    }

    const handleGlobalNewSession = () => {
      // Handle ⌘N from terminal (custom event)
      if (!newSessionOpen && !cancelModalOpen) {
        logger.info('[App] Global new session shortcut triggered (agent mode)')
        // Store current focus before opening modal
        previousFocusRef.current = document.activeElement
         setOpenAsSpec(false) // Explicitly set to false for global shortcut
        setNewSessionOpen(true)
      }
    }

    const handleOpenDiffView = () => {
      setSelectedDiffFile(null)
      setIsDiffViewerOpen(true)
    }
    const handleOpenDiffFile = (e: Event) => {
      const customEvent = e as CustomEvent<{ filePath?: string }>
      const filePath = customEvent?.detail?.filePath || null
      setSelectedDiffFile(filePath)
      setIsDiffViewerOpen(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('global-new-session-shortcut', handleGlobalNewSession)
    window.addEventListener('schaltwerk:open-diff-view', handleOpenDiffView as EventListener)
    window.addEventListener('schaltwerk:open-diff-file', handleOpenDiffFile as EventListener)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('global-new-session-shortcut', handleGlobalNewSession)
      window.removeEventListener('schaltwerk:open-diff-view', handleOpenDiffView as EventListener)
      window.removeEventListener('schaltwerk:open-diff-file', handleOpenDiffFile as EventListener)
    }
  }, [newSessionOpen, cancelModalOpen, increaseFontSizes, decreaseFontSizes, resetFontSizes, keyboardShortcutConfig, platform])

  // Open NewSessionModal in spec creation mode when requested
  useEffect(() => {
    const handler = () => {
      logger.info('[App] schaltwerk:new-spec event received - opening modal for spec creation')
      previousFocusRef.current = document.activeElement
                       setOpenAsSpec(true)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-spec', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:new-spec', handler as EventListener)
  }, [])
  
  

  // Open NewSessionModal for new agent when requested
  useEffect(() => {
    const handler = () => {
      logger.info('[App] schaltwerk:new-session event received - opening modal in agent mode')
      previousFocusRef.current = document.activeElement
       setOpenAsSpec(false)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-session', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:new-session', handler as EventListener)
  }, [])

  // Open Start Agent modal prefilled from an existing spec
  useEffect(() => {
    const handler = async (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>
      logger.info('[App] Received start-agent-from-spec event:', customEvent.detail)
      const name = customEvent.detail?.name
      if (!name) {
        logger.warn('[App] No name provided in start-agent-from-spec event')
        return
      }
      // Store focus and open modal
      previousFocusRef.current = document.activeElement

      // Notify modal that prefill is coming
      window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill-pending'))

      // Fetch spec content first, then open modal with prefilled data
      logger.info('[App] Fetching session data for prefill:', name)
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
          window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill', {
            detail: prefillData
          }))
        })
      } else {
        logger.warn('[App] No prefill data fetched for session:', name)
      }
    }
    window.addEventListener('schaltwerk:start-agent-from-spec', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:start-agent-from-spec', handler as EventListener)
  }, [fetchSessionForPrefill])


  const handleDeleteSpec = async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke(TauriCommands.SchaltwerkCoreArchiveSpecSession, { name: currentSession.name })
      setDeleteSpecModalOpen(false)
      // No manual selection here; SessionRemoved + SessionsRefreshed will drive next focus
    } catch (error) {
      logger.error('Failed to delete spec:', error)
      alert(`Failed to delete spec: ${error}`)
    } finally {
      setIsCancelling(false)
    }
  }

  const handleFileSelect = (filePath: string) => {
    setSelectedDiffFile(filePath)
    setIsDiffViewerOpen(true)
  }

  const handleCloseDiffViewer = () => {
    setIsDiffViewerOpen(false)
  }

  //

  const handleCreateSession = async (data: {
    name: string
    prompt?: string
    baseBranch: string
    userEditedName?: boolean
    isSpec?: boolean
    draftContent?: string
    versionCount?: number
    agentType?: string
    skipPermissions?: boolean
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
          const count = Math.max(1, Math.min(4, data.versionCount ?? 1))
          let firstSessionName = data.name
          
          // Create array of session names and process them
          const sessionNames = Array.from({ length: count }, (_, i) =>
            i === 0 ? data.name : `${data.name}_v${i + 1}`
          )

          // Generate a stable group id for these versions
          const versionGroupId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
            ? (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID()
            : `${data.name}-${Date.now()}`

          for (const [index, sessionName] of sessionNames.entries()) {
            if (index === 0) {
              await waitForSessionsRefreshed(() =>
                invoke(TauriCommands.SchaltwerkCoreStartSpecSession, {
                  name: sessionName,
                  baseBranch: data.baseBranch || null,
                  versionGroupId,
                  versionNumber: 1,
                  agentType: data.agentType || null,
                  skipPermissions: data.skipPermissions ?? null,
                })
              )
            } else {
              await waitForSessionsRefreshed(() =>
                invoke(TauriCommands.SchaltwerkCoreCreateAndStartSpecSession, {
                  name: sessionName,
                  specContent: contentToUse,
                  baseBranch: data.baseBranch || null,
                  versionGroupId,
                  versionNumber: index + 1,
                  agentType: data.agentType || null,
                  skipPermissions: data.skipPermissions ?? null,
                })
              )
            }
          }

          setNewSessionOpen(false)
          setStartFromSpecName(null)

          // Dispatch event for other components to know a session was created from spec
          window.dispatchEvent(new CustomEvent('schaltwerk:session-created', {
            detail: { name: firstSessionName }
          }))

          // Start agents for all spec-derived sessions (this creates terminals with agents)
          // This ensures all versions start working immediately, not just the focused one
          for (const sessionName of sessionNames) {
            try {
              // Start the AI agent (this creates the top terminal with agent)
              await invoke(TauriCommands.SchaltwerkCoreStartClaude, {
                sessionName: sessionName,
                // Provide a generous initial size to avoid first-frame wrapping before UI fit
                cols: 220,
                rows: 60
              })
              
              // Bottom terminals are created on demand by TerminalTabs (-bottom-0). Nothing to do here.
              logger.info(`[App] Started agent for session ${sessionName}`)
            } catch (_e) {
              logger.warn(`[App] Failed to start agent for session ${sessionName}:`, _e)
            }
          }

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

          // Dispatch event for other components to know a spec was created
          window.dispatchEvent(new CustomEvent('schaltwerk:spec-created', {
            detail: { name: data.name }
          }))
        } else {
          // Start path mirrors spec flow: create a spec per version and start it immediately
          const count = Math.max(1, Math.min(4, data.versionCount ?? 1))
          const baseName = data.name
          const contentToUse = data.prompt || ''
          const versionGroupId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
            ? (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID()
            : `${baseName}-${Date.now()}`

          for (let i = 1; i <= count; i++) {
            const versionName = i === 1 ? baseName : `${baseName}_v${i}`
            await waitForSessionsRefreshed(() =>
              invoke(TauriCommands.SchaltwerkCoreCreateAndStartSpecSession, {
                name: versionName,
                specContent: contentToUse,
                baseBranch: data.baseBranch || null,
                versionGroupId,
                versionNumber: i,
                agentType: data.agentType || null,
                skipPermissions: data.skipPermissions ?? null,
              })
            )
            // Explicitly start the agent process like the spec-start path does
            try {
              await invoke(TauriCommands.SchaltwerkCoreStartClaude, {
                sessionName: versionName,
                cols: 220,
                rows: 60,
              })
            } catch (e) {
              logger.warn(`[App] Failed to start agent for ${versionName}:`, e)
            }
            // Mark the corresponding terminal as background-started to avoid duplicate auto-start
            const sanitized = versionName.replace(/[^a-zA-Z0-9_-]/g, '_')
            const topId = `session-${sanitized}-top`
            markBackgroundStart(topId)
          }

          setNewSessionOpen(false)
          // Do not switch focus; keep user in current session
          window.dispatchEvent(new CustomEvent('schaltwerk:session-created', {
            detail: { name: data.name }
          }))
        }
      })
    } catch (error) {
      logger.error('Failed to create session:', error)
      alert(`Failed to create session: ${error}`)
    }
  }

  const handleOpenProject = async (path: string) => {
    try {
      // Check if tab already exists
      const existingTab = openTabs.find(tab => tab.projectPath === path)
      if (existingTab) {
        // Switch to existing tab - ensure backend knows about the project switch
        await invoke(TauriCommands.InitializeProject, { path })
        setActiveTabPath(path)
        setProjectPath(path)
        setShowHome(false)
        return
      }

      // Initialize and add new tab
      await invoke(TauriCommands.InitializeProject, { path })
      await invoke(TauriCommands.AddRecentProject, { path })

      const projectName = getBasename(path)
      const newTab: ProjectTab = {
        projectPath: path,
        projectName
      }

      setOpenTabs(prev => [...prev, newTab])
      setActiveTabPath(path)
      setProjectPath(path)
      setShowHome(false)
      // SelectionContext will automatically update orchestrator when projectPath changes
    } catch (error) {
      logger.error('Failed to open project:', error)
      alert(`Failed to open project: ${error}`)
    }
  }

  const handleGoHome = () => {
    setShowHome(true)
    setActiveTabPath(null)
    setProjectPath(null)
  }

  const handleSelectTab = useCallback(async (path: string): Promise<boolean> => {
    // Prevent redundant calls when already focused on the requested project
    if (path === activeTabPath && path === projectPath) {
      return true
    }

    const ongoingSwitch = projectSwitchPromiseRef.current

    if (ongoingSwitch) {
      // If we're already switching to this path, reuse the inflight promise
      if (projectSwitchTargetRef.current === path) {
        return ongoingSwitch
      }

      // Otherwise abort the previous target and wait for it to settle
      if (projectSwitchAbortControllerRef.current) {
        projectSwitchAbortControllerRef.current.abort()
      }

      try {
        await ongoingSwitch
      } catch (error) {
        logger.warn('Previous project switch failed while awaiting completion:', error)
      }
    }

    // State might already be updated after awaiting the previous switch
    if (path === activeTabPath && path === projectPath) {
      return true
    }

    const runSwitch = async (): Promise<boolean> => {
      const abortController = new AbortController()
      projectSwitchAbortControllerRef.current = abortController
      projectSwitchTargetRef.current = path

      try {
        await invoke(TauriCommands.InitializeProject, { path })

        if (abortController.signal.aborted) {
          return false
        }

        setActiveTabPath(path)
        setProjectPath(path)
        setShowHome(false)
        return true
      } catch (error) {
        if (!abortController.signal.aborted) {
          logger.error('Failed to switch project in backend:', error)
        }
        return false
      } finally {
        if (projectSwitchAbortControllerRef.current === abortController) {
          projectSwitchAbortControllerRef.current = null
        }
        if (projectSwitchTargetRef.current === path) {
          projectSwitchTargetRef.current = null
        }
      }
    }

    const switchPromise = runSwitch().finally(() => {
      if (projectSwitchPromiseRef.current === switchPromise) {
        projectSwitchPromiseRef.current = null
      }
    })

    projectSwitchPromiseRef.current = switchPromise

    return switchPromise
  }, [activeTabPath, projectPath, setProjectPath])

  const handleCloseTab = async (path: string) => {
    const tabIndex = openTabs.findIndex(tab => tab.projectPath === path)
    if (tabIndex === -1) return

    const closingActiveTab = path === activeTabPath

    if (closingActiveTab) {
      const nextActiveTab = determineNextActiveTab(openTabs, path)
      if (nextActiveTab) {
        const switched = await handleSelectTab(nextActiveTab.projectPath)
        if (!switched) {
          logger.warn('Aborting tab close because adjacent project failed to activate')
          return
        }
      } else {
        handleGoHome()
      }
    }

    // Remove the tab from UI
    const newTabs = openTabs.filter(tab => tab.projectPath !== path)
    setOpenTabs(newTabs)

    // Clean up the closed project in backend
    try {
      await invoke(TauriCommands.CloseProject, { path })
      // Also clear frontend terminal tracking to avoid stale state on reopen
      // Compute orchestrator terminal IDs for this project (must match SelectionContext logic)
      try {
        const dirName = path.split(/[/\\]/).pop() || 'unknown'
        const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
        // Simple deterministic hash of full path
        let hash = 0
        for (let i = 0; i < path.length; i++) {
          hash = ((hash << 5) - hash) + path.charCodeAt(i)
          hash = hash & hash // 32-bit
        }
        const projectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
        const base = `orchestrator-${projectId}`
        const topId = `${base}-top`
        const bottomBaseId = `${base}-bottom`

        // Clear started guard so orchestrator can auto-start on reopen
        clearTerminalStartedTracking([topId])
        // Clear creation tracking so ensureTerminals will recreate if needed
        await clearTerminalTracking([topId, bottomBaseId])
      } catch (_e) {
        logger.warn('Failed to clear terminal tracking for closed project:', _e)
      }
    } catch (error) {
      logger.warn('Failed to cleanup closed project:', error)
      // Don't fail the UI operation if cleanup fails
    }
  }

  const switchProject = useCallback(async (direction: 'prev' | 'next') => {
    if (openTabs.length <= 1) return
    
    const currentIndex = openTabs.findIndex(tab => tab.projectPath === activeTabPath)
    if (currentIndex === -1) return
    
    // Calculate new index with proper boundary constraints
    let newIndex: number
    if (direction === 'next') {
      // Don't go past the last tab
      newIndex = Math.min(currentIndex + 1, openTabs.length - 1)
    } else {
      // Don't go before the first tab
      newIndex = Math.max(currentIndex - 1, 0)
    }
    
    // Only switch if we actually moved to a different index
    if (newIndex !== currentIndex) {
      const targetTab = openTabs[newIndex]
      if (targetTab?.projectPath) {
        await handleSelectTab(targetTab.projectPath)
      }
    }
  }, [openTabs, activeTabPath, handleSelectTab])

  const handleSelectPrevProject = useCallback(() => {
    switchProject('prev')
  }, [switchProject])

  const handleSelectNextProject = useCallback(() => {
    switchProject('next')
  }, [switchProject])

  // Update unified work area ring color when selection changes
  useEffect(() => {
    const el = document.getElementById('work-ring')
    if (!el) return
    // Remove the ring entirely - no visual indicator needed
    el.style.boxShadow = 'none'
  }, [selection])

  if (showHome && openTabs.length === 0) {
    return (
      <>
        <TopBar
          tabs={[]}
          activeTabPath={null}
          onGoHome={() => {}}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="pt-[32px] h-full">
          <HomeScreen onOpenProject={handleOpenProject} />
        </div>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </>
    )
  }

  return (
    <ErrorBoundary name="App">
      {/* Show TopBar always */}
      <TopBar
        tabs={openTabs}
        activeTabPath={activeTabPath}
        onGoHome={handleGoHome}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenSettings={() => setSettingsOpen(true)}
        resolveOpenPath={async () => resolveOpenPathForOpenButton({
          selection,
          activeTabPath,
          projectPath,
          invoke
        })}
        isRightPanelCollapsed={isRightCollapsed}
        onToggleRightPanel={toggleRightPanelCollapsed}
      />

      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <div className="pt-[32px] h-full">
          <ErrorBoundary name="HomeScreen">
            <HomeScreen onOpenProject={handleOpenProject} />
          </ErrorBoundary>
        </div>
      )}

      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
        <>
          <Split className="h-full w-full flex pt-[32px]" sizes={[20, 80]} minSize={[240, 400]} gutterSize={6}>
            <div className="h-full border-r overflow-y-auto" style={{ backgroundColor: theme.colors.background.secondary, borderRightColor: theme.colors.border.default }} data-testid="sidebar">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-y-auto">
                  <SessionErrorBoundary>
                    <Sidebar 
                    isDiffViewerOpen={isDiffViewerOpen} 
                    openTabs={openTabs}
                    onSelectPrevProject={handleSelectPrevProject}
                    onSelectNextProject={handleSelectNextProject}
                  />
                  </SessionErrorBoundary>
                </div>
                <div className="p-2 border-t grid grid-cols-2 gap-2" style={{ borderTopColor: theme.colors.border.default }}>
                  <button
                    onClick={() => {
                      previousFocusRef.current = document.activeElement
                      setNewSessionOpen(true)
                    }}
                    className="w-full text-sm px-3 py-1.5 rounded group flex items-center justify-between transition-colors"
                    style={{
                      backgroundColor: `${theme.colors.background.elevated}99`,
                      color: theme.colors.text.primary
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.background.hover}99`}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = `${theme.colors.background.elevated}99`}
                    title="Start agent (⌘N)"
                  >
                    <span>Start Agent</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                  </button>
                  <button
                    onClick={() => {
                      previousFocusRef.current = document.activeElement
                      setOpenAsSpec(true)
                      setNewSessionOpen(true)
                    }}
                    className="w-full text-sm px-3 py-1.5 rounded group flex items-center justify-between border transition-colors"
                    style={{
                      backgroundColor: theme.colors.accent.amber.bg,
                      borderColor: theme.colors.accent.amber.border,
                      color: theme.colors.text.primary
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = `${theme.colors.accent.amber.DEFAULT}33`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = theme.colors.accent.amber.bg
                    }}
                    title="Create spec (⇧⌘N)"
                  >
                    <span>Create Spec</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                  </button>
                </div>
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
                  sizes={rightSizes} 
                  minSize={[400, 280]} 
                  gutterSize={8}
                  onDragStart={handleRightSplitDragStart}
                  onDragEnd={handleRightSplitDragEnd}
                >
                  <main className="h-full" style={{ backgroundColor: theme.colors.background.primary }} data-testid="terminal-grid">
                    <ErrorBoundary name="TerminalGrid">
                      <TerminalGrid />
                    </ErrorBoundary>
                  </main>
                  <section className={`overflow-hidden ${isDraggingRightSplit ? '' : 'transition-all duration-200'}`}>
                    <ErrorBoundary name="RightPanel">
                      <RightPanelTabs 
                        onFileSelect={handleFileSelect}
                        isDragging={isDraggingRightSplit}
                      />
                    </ErrorBoundary>
                  </section>
                </Split>
              )}
            </div>
          </Split>

           <NewSessionModal
             open={newSessionOpen}
             initialIsDraft={openAsDraft}
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
             onCreate={(data) => handleCreateSession({...data, attachedImages: data.attachedImages || []})}\n           />

          {currentSession && (
            <>
              <CancelConfirmation
                open={cancelModalOpen}
                displayName={currentSession.displayName}
                branch={currentSession.branch}
                hasUncommittedChanges={currentSession.hasUncommittedChanges}
                onConfirm={handleCancelSession}
                onCancel={() => setCancelModalOpen(false)}
                loading={isCancelling}
              />
               <DeleteSpecConfirmation
                 open={deleteSpecModalOpen}
                 displayName={currentSession.displayName}
                 onConfirm={handleDeleteSpec}
                 onCancel={() => setDeleteSpecModalOpen(false)}
                 loading={isCancelling}
               />
            </>
          )}

          {/* Diff Viewer Modal with Review - render only when open */}
          {isDiffViewerOpen && (
            <UnifiedDiffModal
              filePath={selectedDiffFile}
              isOpen={true}
              onClose={handleCloseDiffViewer}
            />
          )}
          

          {/* Settings Modal */}
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onOpenTutorial={openOnboarding}
          />

          <OnboardingModal
            open={isOnboardingOpen}
            onClose={closeOnboarding}
            onComplete={completeOnboarding}
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
                // Trigger a re-attempt to start the agent
                window.dispatchEvent(new CustomEvent('schaltwerk:retry-agent-start'))
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
