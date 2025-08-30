import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { listen } from '@tauri-apps/api/event'
import { useSelection } from './contexts/SelectionContext'
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
import { useSessions } from './contexts/SessionsContext'
import { SpecModeLayout } from './components/plans/SpecModeLayout'
import { theme } from './common/theme'

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

export default function App() {
  const { selection, setSelection } = useSelection()
  const { projectPath, setProjectPath } = useProject()
  const { sessions } = useSessions()
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
  const [isKanbanOpen, setIsKanbanOpen] = useState(false)
  const [commanderSpecModeSession, setCommanderSpecModeSession] = useState<string | null>(null)
  const projectSwitchInProgressRef = useRef(false)
  const projectSwitchAbortControllerRef = useRef<AbortController | null>(null)
  const isKanbanOpenRef = useRef(false)
  const previousFocusRef = useRef<Element | null>(null)
  
  // Keep ref in sync with state
  useEffect(() => {
    isKanbanOpenRef.current = isKanbanOpen
  }, [isKanbanOpen])
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  // Helper function to handle session cancellation
  const handleCancelSession = useCallback(async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke('schaltwerk_core_cancel_session', {
        name: currentSession.name
      })
      setCancelModalOpen(false)

    } catch (error) {
      console.error('Failed to cancel session:', error)
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

      console.log('Activated project:', path)

      // If repository has no commits, trigger New Project flow
      try {
        const isEmpty = await invoke<boolean>('repository_is_empty')
        if (isEmpty) {
          setShowHome(true)
          window.dispatchEvent(new CustomEvent('schaltwerk:open-new-project-dialog'))
        }
      } catch (e) {
        console.warn('Failed to check if repository is empty:', e)
      }
    } catch (error) {
      console.error('Failed to activate project:', error)
    }
  }, [setProjectPath, setShowHome, setOpenTabs, setActiveTabPath])

  // Handle CLI directory argument
  useEffect(() => {
    // Handle opening a Git repository
    const unlistenDirectoryPromise = listen<string>('schaltwerk:open-directory', async (event) => {
      const directoryPath = event.payload
      console.log('Received open-directory event:', directoryPath)
      await applyActiveProject(directoryPath, { initializeBackend: true })
    })

    // Handle opening home screen for non-Git directories
    const unlistenHomePromise = listen<string>('schaltwerk:open-home', async (event) => {
      const directoryPath = event.payload
      console.log('Received open-home event for non-Git directory:', directoryPath)
      setShowHome(true)
      console.log('Opened home screen because', directoryPath, 'is not a Git repository')
    })

    // Deterministically pull active project on mount to avoid event race
    ;(async () => {
      try {
        const active = await invoke<string | null>('get_active_project_path')
        if (active) {
          console.log('Detected active project on startup:', active)
          // Backend already set the project; only sync UI state
          await applyActiveProject(active, { initializeBackend: false })
        }
      } catch (e) {
        console.warn('Failed to fetch active project on startup:', e)
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
          console.log('[App] Cmd+N triggered - opening new session modal (agent mode)')
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
          console.log('[App] Cmd+Shift+N triggered - opening new session modal (spec mode)')
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
        console.log('[App] Global new session shortcut triggered (agent mode)')
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
      console.log('[App] schaltwerk:new-spec event received - opening modal in spec mode')
      previousFocusRef.current = document.activeElement
                       setOpenAsSpec(true)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-spec', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:new-spec', handler as EventListener)
  }, [])
  
  // Auto-enter spec mode when a new spec is created
  useEffect(() => {
    const handleSpecCreated = (event: CustomEvent<{ name: string }>) => {
      if (selection.kind === 'orchestrator') {
        // Automatically switch to the newly created spec in spec mode
        setCommanderSpecModeSession(event.detail.name)
      }
    }
    window.addEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
    return () => window.removeEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
  }, [selection])
  
  // Handle MCP spec updates - detect new specs and focus them in spec mode
  useEffect(() => {
    const handleSessionsRefreshed = () => {
      // Check if we're in orchestrator and spec mode
      if (selection.kind === 'orchestrator' && commanderSpecModeSession) {
        // Check if a new spec was created that we should focus
              const specSessions = sessions.filter(session =>
                session.info.status === 'spec' || session.info.session_state === 'spec'
              )

        // If we don't have a valid spec selected but specs exist, select the first one
        if (!specSessions.find(p => p.info.session_id === commanderSpecModeSession) && specSessions.length > 0) {
          // The current spec doesn't exist anymore, switch to the newest spec
          const newestSpec = specSessions.sort((a, b) => {
            const aTime = new Date(a.info.created_at || '').getTime()
            const bTime = new Date(b.info.created_at || '').getTime()
            return bTime - aTime  // Sort newest first
          })[0]
          setCommanderSpecModeSession(newestSpec.info.session_id)
        }
      }
    }

    // Use Tauri's listen for the sessions-refreshed event
    const unlisten = listen('schaltwerk:sessions-refreshed', handleSessionsRefreshed)

    return () => {
      unlisten.then(unlistenFn => unlistenFn())
    }
  }, [selection, commanderSpecModeSession, sessions])
  
  // Open NewSessionModal for new agent when requested
  useEffect(() => {
    const handler = () => {
      console.log('[App] schaltwerk:new-session event received - opening modal in agent mode')
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
      console.log('[App] Received start-agent-from-spec event:', customEvent.detail)
      const name = customEvent.detail?.name
      if (!name) {
        console.warn('[App] No name provided in start-agent-from-spec event')
        return
      }
      // Store focus and open modal
      previousFocusRef.current = document.activeElement

      // Notify modal that prefill is coming
      window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill-pending'))

      // Fetch spec content first, then open modal with prefilled data
      console.log('[App] Fetching session data for prefill:', name)
      const prefillData = await fetchSessionForPrefill(name)
      console.log('[App] Fetched prefill data:', prefillData)

      // Open modal after data is ready
      setNewSessionOpen(true)
      setStartFromSpecName(name)

      // Dispatch prefill event with fetched data
      if (prefillData) {
        // Use requestAnimationFrame to ensure modal is rendered before dispatching
        requestAnimationFrame(() => {
          console.log('[App] Dispatching prefill event with data')
          window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill', {
            detail: prefillData
          }))
        })
      } else {
        console.warn('[App] No prefill data fetched for session:', name)
      }
    }
    window.addEventListener('schaltwerk:start-agent-from-spec', handler as EventListener)
    return () => window.removeEventListener('schaltwerk:start-agent-from-spec', handler as EventListener)
  }, [fetchSessionForPrefill])

  // Handle entering spec mode
  useEffect(() => {
    const handleEnterSpecMode = (event: CustomEvent<{ sessionName: string }>) => {
      const { sessionName } = event.detail
      if (sessionName && selection.kind === 'orchestrator') {
        setCommanderSpecModeSession(sessionName)
      }
    }

    window.addEventListener('schaltwerk:enter-spec-mode', handleEnterSpecMode as EventListener)
    return () => window.removeEventListener('schaltwerk:enter-spec-mode', handleEnterSpecMode as EventListener)
  }, [selection])

  // Handle exiting spec mode
  const handleExitSpecMode = useCallback(() => {
    setCommanderSpecModeSession(null)
  }, [])
  
  // Exit spec mode if selection changes away from orchestrator
  useEffect(() => {
    if (selection.kind !== 'orchestrator') {
      setCommanderSpecModeSession(null)
    }
  }, [selection])
  
  // Handle keyboard shortcut for spec mode (Cmd+Shift+S in orchestrator)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        if (selection.kind === 'orchestrator') {
          e.preventDefault()
          if (commanderSpecModeSession) {
            // Exit spec mode
            setCommanderSpecModeSession(null)
          } else {
            // Enter spec mode with first available spec
            const specSessions = sessions.filter(session =>
              session.info.status === 'spec' || session.info.session_state === 'spec'
            )
            if (specSessions.length > 0) {
              setCommanderSpecModeSession(specSessions[0].info.session_id)
            } else {
              // No specs available, create a new one
              window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, commanderSpecModeSession, sessions])

  const handleDeleteSpec = async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke('schaltwerk_core_cancel_session', {
        name: currentSession.name
      })
      setDeleteSpecModalOpen(false)
      // Reload sessions to update the list
      await invoke('schaltwerk_core_list_enriched_sessions')
    } catch (error) {
      console.error('Failed to delete spec:', error)
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

  const handleCreateSession = async (data: {
    name: string
    prompt?: string
    baseBranch: string
    userEditedName?: boolean
    isSpec?: boolean
    draftContent?: string
  }) => {
    try {
      // Get current filter settings to determine if we should select the new session
      let currentFilterMode = 'all' // Default
      try {
        const settings = await invoke<{ filter_mode: string; sort_mode: string }>('get_project_sessions_settings')
        if (settings) {
          currentFilterMode = settings.filter_mode
        }
      } catch {
        // If we can't get settings, assume 'all' filter
      }
      
       // If starting from an existing spec via the modal, convert that spec to active
       if (!data.isSpec && startFromDraftName && startFromDraftName === data.name) {
         // Ensure the spec content reflects latest prompt before starting
         const contentToUse = data.prompt || ''
         if (contentToUse.trim().length > 0) {
           await invoke('schaltwerk_core_update_spec_content', {
             name: data.name,
             content: contentToUse,
           })
         }
         // Start the spec session (transitions spec -> active and creates worktree)
         await invoke('schaltwerk_core_start_spec_session', {
           name: data.name,
           baseBranch: data.baseBranch || null,
         })
         setNewSessionOpen(false)
         setStartFromSpecName(null)

        // Small delay to ensure sessions list is updated
        await new Promise(resolve => setTimeout(resolve, 200))

        // Get the started session to get correct worktree path and state
        const sessionData = await invoke<{ worktree_path: string; session_state: string }>('schaltwerk_core_get_session', { name: data.name })

        // Only switch to the session if it matches the current filter
        // Running sessions are visible in 'all' and 'running' filters
        if (currentFilterMode === 'all' || currentFilterMode === 'running') {
          // Switch to the now-running session - the SelectionContext will handle the state transition
          // Backend will handle agent start automatically
          await setSelection({
            kind: 'session',
            payload: data.name,
            worktreePath: sessionData.worktree_path,
            sessionState: 'running' // Spec has been started, it's now running
          })
        }
        return
      }

      if (data.isSpec) {
         // Create spec session
         await invoke('schaltwerk_core_create_spec_session', {
           name: data.name,
           specContent: data.draftContent || '',
         })
        setNewSessionOpen(false)

        // Only select the new spec if it matches the current filter
        // Specs are visible in 'all' and 'spec' filters
        if (currentFilterMode === 'all' || currentFilterMode === 'spec') {
           // If in orchestrator, automatically enter spec mode with the new spec
           if (selection.kind === 'orchestrator') {
             setCommanderSpecModeSession(data.name)
           }
        }
        
        // Dispatch event for other components to know a spec was created
        window.dispatchEvent(new CustomEvent('schaltwerk:spec-created', {
          detail: { name: data.name }
        }))
      } else {
        // Create regular session
        await invoke('schaltwerk_core_create_session', {
          name: data.name,
          prompt: data.prompt || null,
          baseBranch: data.baseBranch || null,
          userEditedName: data.userEditedName ?? false,
        })
        setNewSessionOpen(false)

        // Get the created session to get the correct worktree path
        const sessionData = await invoke<{ worktree_path: string }>('schaltwerk_core_get_session', { name: data.name })

        // Only switch to the new session if it matches the current filter
        // Running sessions are visible in 'all' and 'running' filters
        if (currentFilterMode === 'all' || currentFilterMode === 'running') {
          // Switch to the new session immediately - context handles terminal creation and Claude start
          await setSelection({
            kind: 'session',
            payload: data.name,
            worktreePath: sessionData.worktree_path
          })
        }
      }
    } catch (error) {
      console.error('Failed to create session:', error)
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
      console.error('Failed to open project:', error)
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
      console.log('Project switch already in progress, ignoring request')
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
        console.error('Failed to switch project in backend:', error)
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
            console.error('Failed to switch to new project:', error)
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
    } catch (error) {
      console.warn('Failed to cleanup closed project:', error)
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
      {/* Show TopBar always */}
      <TopBar
        tabs={openTabs}
        activeTabPath={activeTabPath}
        onGoHome={handleGoHome}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenKanban={() => setIsKanbanOpen(true)}
        isOrchestratorActive={selection.kind === 'orchestrator'}
         isSpecModeActive={!!commanderSpecModeSession}
         onToggleSpecMode={() => {
           if (commanderSpecModeSession) {
              setCommanderSpecModeSession(null)
           } else {
             // Select the first available spec
             const specSessions = sessions.filter(session =>
               session.info.status === 'spec' || session.info.session_state === 'spec'
             )
             if (specSessions.length > 0) {
               setCommanderSpecModeSession(specSessions[0].info.session_id)
             } else {
               // No specs available, could show a message or create a new spec
               window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
             }
           }
         }}
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
              {/* Show Spec Mode Layout when active in orchestrator */}
               {selection.kind === 'orchestrator' && commanderSpecModeSession ? (
                 <SpecModeLayout
                   sessionName={commanderSpecModeSession}
                   onExit={handleExitSpecMode}
                   onSwitchSpec={(newSpecName: string) => setCommanderSpecModeSession(newSpecName)}
                 />
               ) : (
                <>
                  {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
                  <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
                  <Split className="h-full w-full flex" sizes={[70, 30]} minSize={[400, 280]} gutterSize={8}>
                    <main className="h-full" style={{ backgroundColor: theme.colors.background.primary }} data-testid="terminal-grid">
                      <ErrorBoundary name="TerminalGrid">
                        <TerminalGrid />
                      </ErrorBoundary>
                    </main>
                    <section className="overflow-hidden">
                      <ErrorBoundary name="RightPanel">
                        <RightPanelTabs onFileSelect={handleFileSelect} />
                      </ErrorBoundary>
                    </section>
                  </Split>
                </>
              )}
            </div>
          </Split>

           <NewSessionModal
             open={newSessionOpen}
             initialIsDraft={openAsDraft}
             onClose={() => {
               console.log('[App] NewSessionModal closing - resetting state')
               setNewSessionOpen(false)
               setOpenAsSpec(false) // Always reset to false when closing
               setStartFromSpecName(null)
               // Restore focus after modal closes
               if (previousFocusRef.current && previousFocusRef.current instanceof HTMLElement) {
                 setTimeout(() => {
                   try {
                     (previousFocusRef.current as HTMLElement).focus()
                   } catch (error) {
                     console.warn('[App] Failed to restore focus after NewSessionModal closed:', error)
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
                console.log(`Folder permission granted for: ${permissionDeniedPath}`)
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
