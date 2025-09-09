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
import { ProjectTab } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { PermissionPrompt } from './components/PermissionPrompt'
import { KanbanModal } from './components/kanban/KanbanModal'
import { OnboardingModal } from './components/onboarding/OnboardingModal'
import { useOnboarding } from './hooks/useOnboarding'
import { useSessionPrefill } from './hooks/useSessionPrefill'
import { useSpecMode } from './hooks/useSpecMode'
import { useSessions } from './contexts/SessionsContext'
import { SpecModeLayout } from './components/plans/SpecModeLayout'
import { theme } from './common/theme'
import { resolveOpenPathForOpenButton } from './utils/resolveOpenPath'
import { TauriCommands } from './common/tauriCommands'
import { logger } from './utils/logger'
import { analytics, AnalyticsEventName } from './analytics'
import { ConsentBanner } from './components/ConsentBanner'
import { getVersion } from '@tauri-apps/api/app'

// Simple debounce utility
function debounce<T extends (...args: never[]) => unknown>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout | null = null
  return ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }) as T
}

export interface SessionActionEvent {
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

// Helper function to validate percentage values for panel sizing
export function validatePanelPercentage(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const numValue = Number(value)
  return !Number.isNaN(numValue) && numValue > 0 && numValue < 100 ? numValue : defaultValue
}

export default function App() {
  const { selection, setSelection, clearTerminalTracking } = useSelection()
  const { projectPath, setProjectPath } = useProject()
  const { sessions, allSessions, setFilterMode, filterMode } = useSessions()
  const { increaseFontSizes, decreaseFontSizes, resetFontSizes } = useFontSize()
  const { isOnboardingOpen, completeOnboarding, closeOnboarding, openOnboarding } = useOnboarding()
  const { fetchSessionForPrefill } = useSessionPrefill()
  const { 
    commanderSpecModeSession, 
    setCommanderSpecModeSession, 
    handleExitSpecMode, 
    handleSpecConverted, 
    toggleSpecMode,
    specModeState
  } = useSpecMode({ projectPath, selection, sessions: allSessions, setFilterMode, setSelection, currentFilterMode: filterMode })
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
  const [isKanbanOpen, setIsKanbanOpen] = useState(false)
  const projectSwitchInProgressRef = useRef(false)
  const projectSwitchAbortControllerRef = useRef<AbortController | null>(null)
  const isKanbanOpenRef = useRef(false)
  const previousFocusRef = useRef<Element | null>(null)
  
  // Right panel collapse state
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(() => {
    const key = 'default' // Will be updated when selection is available
    return sessionStorage.getItem(`schaltwerk:right-panel:collapsed:${key}`) === 'true'
  })
  const [lastExpandedRightPercent, setLastExpandedRightPercent] = useState<number>(() => {
    const key = 'default' // Will be updated when selection is available
    const rawExpanded = sessionStorage.getItem(`schaltwerk:right-panel:lastExpanded:${key}`)
    return validatePanelPercentage(rawExpanded, 30)
  })
  const [rightSizes, setRightSizes] = useState<number[]>(() => {
    const key = 'default' // Will be updated when selection is available
    const raw = sessionStorage.getItem(`schaltwerk:right-panel:sizes:${key}`)
    let base: number[] = [70, 30]
    if (raw) {
      try { 
        const parsed = JSON.parse(raw) as number[]
        if (Array.isArray(parsed) && parsed.length === 2) base = parsed 
      } catch (error) {
        logger.warn('[App] Failed to parse right panel sizes from localStorage:', error, 'Raw value:', raw)
      }
    }
    const initialIsCollapsed = sessionStorage.getItem(`schaltwerk:right-panel:collapsed:${key}`) === 'true'
    if (initialIsCollapsed) {
      return [100, 0] // Fully hidden for collapsed state
    }
    return base
  })
  
  // Keep ref in sync with state
  useEffect(() => {
    isKanbanOpenRef.current = isKanbanOpen
  }, [isKanbanOpen])
  
  // Right panel collapse toggle function
  const toggleRightPanelCollapsed = useCallback(() => {
    const newCollapsed = !isRightCollapsed
    setIsRightCollapsed(newCollapsed)
    
    if (newCollapsed) {
      // When collapsing, save current size and set to collapsed size
      const currentRight = rightSizes[1]
      if (currentRight > 0) {
        setLastExpandedRightPercent(currentRight)
      }
      setRightSizes([100, 0]) // 0% for collapsed state (fully hidden)
    } else {
      // When expanding, restore to last expanded size
      const expandedSize = lastExpandedRightPercent || 30
      setRightSizes([100 - expandedSize, expandedSize])
    }
  }, [isRightCollapsed, rightSizes, lastExpandedRightPercent])
  
  // Load right panel state when selection changes
  useEffect(() => {
    const key = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    const rawSizes = sessionStorage.getItem(`schaltwerk:right-panel:sizes:${key}`)
    const rawCollapsed = sessionStorage.getItem(`schaltwerk:right-panel:collapsed:${key}`)
    const rawExpanded = sessionStorage.getItem(`schaltwerk:right-panel:lastExpanded:${key}`)
    
    let nextSizes: number[] = [70, 30]
    let expandedRight = 30
    
    if (rawSizes) {
      try { 
        const parsed = JSON.parse(rawSizes) as number[]
        if (Array.isArray(parsed) && parsed.length === 2) nextSizes = parsed 
      } catch (error) {
        logger.warn('[App] Failed to parse stored right panel sizes for session:', key, error, 'Raw value:', rawSizes)
      }
    }
    if (rawExpanded) {
      expandedRight = validatePanelPercentage(rawExpanded, 30)
    }
    
    // Only change collapsed state if there's an explicit localStorage value for this session
    if (rawCollapsed !== null) {
      const collapsed = rawCollapsed === 'true'
      setIsRightCollapsed(collapsed)
      if (collapsed) {
        setRightSizes([100, 0]) // Fully hidden for collapsed state
      } else {
        setRightSizes(nextSizes)
      }
    } else {
      // No localStorage entry - use default expanded sizes
      setRightSizes(nextSizes)
    }
    
    setLastExpandedRightPercent(expandedRight)
  }, [selection])
  
  // Persist right panel state changes (immediate since we only update on dragEnd)
  useEffect(() => {
    if (!rightSizes || !selection) return
    const key = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    sessionStorage.setItem(`schaltwerk:right-panel:sizes:${key}`, JSON.stringify(rightSizes))
    if (!isRightCollapsed) {
      setLastExpandedRightPercent(rightSizes[1])
      sessionStorage.setItem(`schaltwerk:right-panel:lastExpanded:${key}`, String(rightSizes[1]))
    }
  }, [rightSizes, isRightCollapsed, selection])
  
  // Persist right panel collapsed state
  useEffect(() => {
    if (!selection) return
    const key = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    sessionStorage.setItem(`schaltwerk:right-panel:collapsed:${key}`, String(isRightCollapsed))
  }, [isRightCollapsed, selection])

  // Right panel drag state for performance optimization
  const [isDraggingRightSplit, setIsDraggingRightSplit] = useState(false)

  // Memoized drag handlers for performance (following TerminalGrid pattern)
  const handleRightSplitDragStart = useCallback(() => {
    document.body.classList.add('is-split-dragging')
    setIsDraggingRightSplit(true)
  }, [])

  const handleRightSplitDragEnd = useCallback((nextSizes: number[]) => {
    setRightSizes(nextSizes)
    setIsRightCollapsed(false)
    document.body.classList.remove('is-split-dragging')
    window.dispatchEvent(new Event('right-panel-split-drag-end'))
    setIsDraggingRightSplit(false)
  }, [])
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  // Helper function to handle session cancellation
  const handleCancelSession = useCallback(async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      
      // Track session cancellation (optional - only if session info is available)
      try {
        const sessionData = await invoke<any>('schaltwerk_core_get_session', { name: currentSession.name })
        const startTime = sessionData?.created_at ? new Date(sessionData.created_at).getTime() : Date.now()
        const durationMinutes = Math.round((Date.now() - startTime) / 60000)
        analytics.track(AnalyticsEventName.SESSION_CANCELLED, { duration_minutes: durationMinutes })
      } catch {
        // Session might not exist, just track without duration
        analytics.track(AnalyticsEventName.SESSION_CANCELLED, { duration_minutes: 0 })
      }
      
      await invoke('schaltwerk_core_cancel_session', {
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
        await invoke('initialize_project', { path })
        await invoke('add_recent_project', { path })
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
        const isEmpty = await invoke<boolean>('repository_is_empty')
        if (isEmpty) {
          setShowHome(true)
          window.dispatchEvent(new CustomEvent('schaltwerk:open-new-project-dialog'))
        }
      } catch (e) {
        logger.warn('Failed to check if repository is empty:', e)
      }
    } catch (error) {
      logger.error('Failed to activate project:', error)
    }
  }, [setProjectPath, setShowHome, setOpenTabs, setActiveTabPath])

  // Handle CLI directory argument
  useEffect(() => {
    // Initialize analytics on app start
    ;(async () => {
      try {
        await analytics.initialize()
        const version = await getVersion()
        analytics.track(AnalyticsEventName.APP_STARTED, { 
          version,
          environment: analytics.getEnvironment(),
          build_source: analytics.getBuildSource()
        })
      } catch (e) {
        logger.error('Failed to initialize analytics:', e)
      }
    })()
    
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
        const active = await invoke<string | null>('get_active_project_path')
        if (active) {
          logger.info('Detected active project on startup:', active)
          // Backend already set the project; only sync UI state
          await applyActiveProject(active, { initializeBackend: false })
        }
      } catch (e) {
        logger.warn('Failed to fetch active project on startup:', e)
      }
    })()

     return () => {
      unlistenDirectoryPromise.then(unlisten => unlisten())
      unlistenHomePromise.then(unlisten => unlisten())
    }
  }, [applyActiveProject, setProjectPath])


  useEffect(() => {
    const handlePermissionError = (event: Event) => {
      const customEvent = event as CustomEvent<{error: string}>
      const error = customEvent.detail?.error
      if (error?.includes('Permission required for folder:')) {
        // Extract the folder path from the error message
        const match = error.match(/Permission required for folder: ([^.]+)/)
        if (match && match[1]) {
          setPermissionDeniedPath(match[1])
        }
        setShowPermissionPrompt(true)
      }
    }

    window.addEventListener('schaltwerk:permission-error', handlePermissionError)

    return () => {
      window.removeEventListener('schaltwerk:permission-error', handlePermissionError)
    }
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
      // Check if we're on macOS using userAgent (platform is deprecated)
      const isMac = navigator.userAgent.toUpperCase().includes('MAC')
      const modifierKey = isMac ? e.metaKey : e.ctrlKey

      if (modifierKey && e.key === 'n') {
        // Don't interfere if a modal is already open or if we're typing in an input
        const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'

        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          logger.info('[App] Cmd+N triggered - opening new session modal (agent mode)')
          // Store current focus before opening modal
          previousFocusRef.current = document.activeElement
           setOpenAsSpec(false) // Explicitly set to false for Cmd+N
          setNewSessionOpen(true)
        }
      }
      // New Spec shortcut: Cmd+Shift+N (deterministic open-as-spec)
      if (modifierKey && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          logger.info('[App] Cmd+Shift+N triggered - opening new session modal (spec mode)')
          // Store current focus before opening modal
          previousFocusRef.current = document.activeElement
          setOpenAsSpec(true)
          setNewSessionOpen(true)
        }
      }

      // Font size shortcuts
      if (modifierKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        increaseFontSizes()
      }
      if (modifierKey && e.key === '-') {
        e.preventDefault()
        decreaseFontSizes()
      }
      if (modifierKey && e.key === '0') {
        e.preventDefault()
        resetFontSizes()
      }
      
      // Kanban board shortcut: Cmd+Shift+K only
      if (modifierKey && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        if (!isInputFocused && !isKanbanOpenRef.current) {
          e.preventDefault()
          setIsKanbanOpen(true)
        }
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

    const handleGlobalKanban = () => {
      // Handle ⌘⇧K from terminal (custom event)
      if (!isKanbanOpenRef.current) {
        setIsKanbanOpen(true)
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
    window.addEventListener('global-kanban-shortcut', handleGlobalKanban)
    window.addEventListener('schaltwerk:open-diff-view', handleOpenDiffView as EventListener)
    window.addEventListener('schaltwerk:open-diff-file', handleOpenDiffFile as EventListener)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('global-new-session-shortcut', handleGlobalNewSession)
      window.removeEventListener('global-kanban-shortcut', handleGlobalKanban)
    window.removeEventListener('schaltwerk:open-diff-view', handleOpenDiffView as EventListener)
    window.removeEventListener('schaltwerk:open-diff-file', handleOpenDiffFile as EventListener)
    }
  }, [newSessionOpen, cancelModalOpen, increaseFontSizes, decreaseFontSizes, resetFontSizes])

  // Open NewSessionModal directly in spec mode when requested
  useEffect(() => {
    const handler = () => {
      logger.info('[App] schaltwerk:new-spec event received - opening modal in spec mode')
      previousFocusRef.current = document.activeElement
                       setOpenAsSpec(true)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-spec', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:new-spec', handler as EventListener)
  }, [])
  
  
  // Load spec mode state when project changes
  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    const savedSpecMode = sessionStorage.getItem(`schaltwerk:spec-mode:${projectId}`)
    if (savedSpecMode && savedSpecMode !== commanderSpecModeSession) {
      // Validate that the saved spec still exists
      const specExists = sessions.find(session => 
        session.info.session_id === savedSpecMode && 
        (session.info.status === 'spec' || session.info.session_state === 'spec')
      )
      if (specExists) {
        setCommanderSpecModeSession(savedSpecMode)
      } else {
        // Saved spec no longer exists, clear from storage
        sessionStorage.removeItem(`schaltwerk:spec-mode:${projectId}`)
      }
    }
  }, [projectPath, sessions, commanderSpecModeSession, setCommanderSpecModeSession])
  
  // Save spec mode state to sessionStorage when it changes
  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    if (commanderSpecModeSession) {
      sessionStorage.setItem(`schaltwerk:spec-mode:${projectId}`, commanderSpecModeSession)
    } else {
      sessionStorage.removeItem(`schaltwerk:spec-mode:${projectId}`)
    }
  }, [commanderSpecModeSession, projectPath])
  
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
      await invoke('schaltwerk_core_archive_spec_session', { name: currentSession.name })
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

  // Helper function to create terminals for a session (avoids code duplication)
  const createTerminalsForSession = async (sessionName: string) => {
    try {
      // Get session data to get correct worktree path
      const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
      const worktreePath = sessionData.worktree_path
      
      // Create terminals for this session using consistent naming pattern
      const sanitizedSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')
      const topTerminalId = `session-${sanitizedSessionName}-top`
      const bottomTerminalId = `session-${sanitizedSessionName}-bottom`
      
      // Create both terminals
      await invoke(TauriCommands.CreateTerminal, { id: topTerminalId, cwd: worktreePath })
      await invoke(TauriCommands.CreateTerminal, { id: bottomTerminalId, cwd: worktreePath })
    } catch (e) {
      logger.warn(`[App] Failed to create terminals for session ${sessionName}:`, e)
    }
  }

  const handleCreateSession = async (data: {
    name: string
    prompt?: string
    baseBranch: string
    userEditedName?: boolean
    isSpec?: boolean
    draftContent?: string
    versionCount?: number
  }) => {
    try {
      
       // If starting from an existing spec via the modal, convert that spec to active
       if (!data.isSpec && startFromDraftName && startFromDraftName === data.name) {
         // If the spec being converted is the current spec mode session, exit spec mode
         handleSpecConverted(data.name)
         
         // Ensure the spec content reflects latest prompt before starting
         const contentToUse = data.prompt || ''
         if (contentToUse.trim().length > 0) {
           await invoke('schaltwerk_core_update_spec_content', {
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
         
         // Track spec to session conversion
         analytics.track(AnalyticsEventName.SPEC_CONVERTED_TO_SESSION, {
           spec_age_minutes: 0 // Could calculate actual age if we had spec creation time
         })
         
         for (const [index, sessionName] of sessionNames.entries()) {
           if (index === 0) {
             // Start the original spec session (transitions spec -> active and creates worktree)
             await invoke(TauriCommands.SchaltwerkCoreStartSpecSession, {
               name: sessionName,
               baseBranch: data.baseBranch || null,
             })
           } else {
             // For additional versions, create and start in one atomic operation to avoid race conditions
             await invoke(TauriCommands.SchaltwerkCoreCreateAndStartSpecSession, {
               name: sessionName,
               specContent: contentToUse,
               baseBranch: data.baseBranch || null,
             })
           }
         }

         setNewSessionOpen(false)
         setStartFromSpecName(null)

        // Dispatch event for other components to know a session was created from spec
        window.dispatchEvent(new CustomEvent('schaltwerk:session-created', {
          detail: { name: firstSessionName }
        }))

        // Small delay to ensure sessions list is updated
        await new Promise(resolve => setTimeout(resolve, 200))

        // Start agents for all spec-derived sessions (this creates terminals with agents)
        // This ensures all versions start working immediately, not just the focused one
        for (const sessionName of sessionNames) {
          try {
            // Start the AI agent (this creates the top terminal with agent)
            await invoke('schaltwerk_core_start_claude', {
              sessionName: sessionName,
              cols: null,
              rows: null
            })
            
            // Create the bottom terminal separately (since agent only creates top)
            const sessionData = await invoke<{ worktree_path: string }>('schaltwerk_core_get_session', { name: sessionName })
            const sanitizedSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')
            const bottomTerminalId = `session-${sanitizedSessionName}-bottom`
            
            await invoke('create_terminal', { 
              id: bottomTerminalId, 
              cwd: sessionData.worktree_path 
            })
            
            logger.info(`[App] Started agent and created terminals for session ${sessionName}`)
          } catch (e) {
            logger.warn(`[App] Failed to start agent for session ${sessionName}:`, e)
          }
        }

        // Don't automatically switch focus when starting spec sessions
        // The user should remain focused on their current session
        return
      }

      if (data.isSpec) {
         // Track spec creation
         analytics.track(AnalyticsEventName.SPEC_CREATED, {
           from_mcp: false
         })
         
         // Create spec session
         await invoke('schaltwerk_core_create_spec_session', {
           name: data.name,
           specContent: data.draftContent || '',
         })
         setNewSessionOpen(false)

        // Only select the new spec if it matches the current filter
        // Specs are visible in 'all' and 'spec' filters
        
        // Dispatch event for other components to know a spec was created
        window.dispatchEvent(new CustomEvent('schaltwerk:spec-created', {
          detail: { name: data.name }
        }))
      } else {
        // Create one or multiple sessions depending on versionCount
        const count = Math.max(1, Math.min(4, data.versionCount ?? 1))
        
        // When creating multiple versions, ensure consistent naming with _v1, _v2, etc.
        const baseName = data.name
        // Consider it auto-generated if the user didn't manually edit the name
        const isAutoGenerated = !data.userEditedName
        
        // Create all versions first
        const createdVersions: string[] = []
        for (let i = 1; i <= count; i++) {
          // First version uses base name, additional versions get _v2, _v3, etc.
          const versionName = i === 1 ? baseName : `${baseName}_v${i}`
          
          // Track session creation (only once for first version)
          if (i === 1) {
            analytics.track(AnalyticsEventName.SESSION_CREATED, {
              agent_type: 'claude',
              from_spec: false
            })
          }
          
          // For single sessions, use userEditedName flag as provided
          // For multiple versions, don't mark as user-edited so they can be renamed as a group
          await invoke(TauriCommands.SchaltwerkCoreCreateSession, {
            name: versionName,
            prompt: data.prompt || null,
            baseBranch: data.baseBranch || null,
            userEditedName: count > 1 ? false : (data.userEditedName ?? false),
          })
          
          createdVersions.push(versionName)
        }
        
        logger.info(`[App] Created ${count} sessions: ${createdVersions.join(', ')}`)
        
        // If we created multiple versions with an auto-generated base name, trigger group rename
        // This needs to happen after a delay to ensure sessions are created
        if (count > 1 && isAutoGenerated && data.prompt) {
          setTimeout(async () => {
            try {
              logger.info(`[App] Attempting to rename version group with baseName: '${baseName}' and prompt: '${data.prompt}'`)
              await invoke('schaltwerk_core_rename_version_group', {
                baseName,
                prompt: data.prompt,
                baseBranch: data.baseBranch || null,
              })
              logger.info(`[App] Successfully renamed version group: '${baseName}'`)
            } catch (err) {
              logger.error('Failed to rename version group:', err)
            }
          }, 1000)
        }
        
        setNewSessionOpen(false)

        // Don't automatically switch focus when creating new sessions
        // The user should remain focused on their current session
        
        // Dispatch event for other components to know a session was created
        window.dispatchEvent(new CustomEvent('schaltwerk:session-created', {
          detail: { name: data.name }
        }))
        
        // For regular (non-spec) sessions with multiple versions, proactively create terminals
        // This addresses the lazy initialization issue where only the first selected session 
        // gets terminals created, leaving other versions without terminals until manually switched
        if (!data.isSpec && count > 1) {
          // Small delay to ensure all sessions are fully created in the database
          await new Promise(resolve => setTimeout(resolve, 200))
          
          // Create terminals for all versions of the new session
          const sessionNames = Array.from({ length: count }, (_, i) => 
            i === 0 ? data.name : `${data.name}_v${i + 1}`
          )
          
          for (const name of sessionNames) {
            await createTerminalsForSession(name)
          }
        }
      }
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
        await invoke('initialize_project', { path })
        setActiveTabPath(path)
        setProjectPath(path)
        setShowHome(false)
        return
      }

      // Initialize and add new tab
      await invoke('initialize_project', { path })
      await invoke('add_recent_project', { path })

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

  const handleSelectTab = useCallback(async (path: string) => {
    // Prevent redundant calls
    if (path === activeTabPath && path === projectPath) {
      return
    }
    
    // Prevent concurrent project switches
    if (projectSwitchInProgressRef.current) {
      logger.info('Project switch already in progress, ignoring request')
      return
    }
    
    // Abort any previous project switch that might be stuck
    if (projectSwitchAbortControllerRef.current) {
      projectSwitchAbortControllerRef.current.abort()
    }
    
    projectSwitchInProgressRef.current = true
    
    const abortController = new AbortController()
    projectSwitchAbortControllerRef.current = abortController
    
    try {
      // Add timeout to prevent indefinite waiting
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Project switch timeout')), 5000)
      })
      
      const switchPromise = invoke('initialize_project', { path })
      
      // Race between the actual switch and timeout
      await Promise.race([switchPromise, timeoutPromise])
      
      // Only update state if not aborted
      if (!abortController.signal.aborted) {
        setActiveTabPath(path)
        setProjectPath(path)
        setShowHome(false)
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        logger.error('Failed to switch project in backend:', error)
      }
      // Don't update state if backend switch failed
      return
    } finally {
      projectSwitchInProgressRef.current = false
      if (projectSwitchAbortControllerRef.current === abortController) {
        projectSwitchAbortControllerRef.current = null
      }
    }
  }, [activeTabPath, projectPath, setProjectPath])

  const handleCloseTab = async (path: string) => {
    const tabIndex = openTabs.findIndex(tab => tab.projectPath === path)
    if (tabIndex === -1) return

    // If this was the active tab, handle navigation first
    if (path === activeTabPath) {
      if (openTabs.length > 1) {
        // Switch to adjacent tab before closing current one
        const newIndex = Math.min(tabIndex, openTabs.length - 2) // -2 because we're removing one
        const newActiveTab = openTabs[newIndex]
        if (newActiveTab && newActiveTab.projectPath !== path) {
          // Switch to the new project in backend first
          try {
            await invoke('initialize_project', { path: newActiveTab.projectPath })
            setActiveTabPath(newActiveTab.projectPath)
            setProjectPath(newActiveTab.projectPath)
          } catch (error) {
            logger.error('Failed to switch to new project:', error)
            // Continue with tab removal even if backend switch fails
          }
        }
      } else {
        // No more tabs, go home
        handleGoHome()
      }
    }

    // Remove the tab from UI
    const newTabs = openTabs.filter(tab => tab.projectPath !== path)
    setOpenTabs(newTabs)

    // Clean up the closed project in backend
    try {
      await invoke('close_project', { path })
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
      } catch (e) {
        logger.warn('Failed to clear terminal tracking for closed project:', e)
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

  const switchProjectDebounced = useMemo(
    () => debounce((direction: 'prev' | 'next') => {
      switchProject(direction)
    }, 300),
    [switchProject]
  )

  const handleSelectPrevProject = useCallback(() => {
    switchProjectDebounced('prev')
  }, [switchProjectDebounced])
  
  const handleSelectNextProject = useCallback(() => {
    switchProjectDebounced('next')
  }, [switchProjectDebounced])

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
      {/* Analytics consent banner */}
      <ConsentBanner />
      
      {/* Show TopBar always */}
      <TopBar
        tabs={openTabs}
        activeTabPath={activeTabPath}
        onGoHome={handleGoHome}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenKanban={() => setIsKanbanOpen(true)}
        isOrchestratorActive={selection.kind === 'orchestrator' && !showHome}
        isSpecModeActive={!!commanderSpecModeSession}
        resolveOpenPath={async () => resolveOpenPathForOpenButton({
          selection,
          activeTabPath,
          projectPath,
          invoke
        })}
        onToggleSpecMode={!showHome ? toggleSpecMode : undefined}
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
                    specModeState={specModeState}
                    onSpecSelect={(specName: string) => {
                      if (selection.kind === 'orchestrator') {
                        setCommanderSpecModeSession(specName)
                      }
                    }}
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
              {/* Show Spec Mode Layout when active in orchestrator */}
               {selection.kind === 'orchestrator' && commanderSpecModeSession ? (
                 <SpecModeLayout
                   sessionName={commanderSpecModeSession}
                   onExit={handleExitSpecMode}
                 />
               ) : (
                <>
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
                </>
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
             onCreate={handleCreateSession}
           />

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
          
          {/* Kanban Modal - render only when open */}
          <KanbanModal 
            isOpen={isKanbanOpen}
            onClose={() => setIsKanbanOpen(false)}
          />

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
}// Test comment added to main
