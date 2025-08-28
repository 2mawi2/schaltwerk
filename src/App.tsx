import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import { UnifiedDiffModal } from './components/diff/UnifiedDiffModal'
import Split from 'react-split'
import { NewSessionModal } from './components/modals/NewSessionModal'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { DeletePlanConfirmation } from './components/modals/DeletePlanConfirmation'
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
import { PlanModeLayout } from './components/plans/PlanModeLayout'
import { theme } from './common/theme'

// Simple debounce utility
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout | null = null
  return ((...args: any[]) => {
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
  const [deletePlanModalOpen, setDeletePlanModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [openTabs, setOpenTabs] = useState<ProjectTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [startFromDraftName, setStartFromDraftName] = useState<string | null>(null)
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)
  const [openAsDraft, setOpenAsDraft] = useState(false)
  const [isKanbanOpen, setIsKanbanOpen] = useState(false)
  const [commanderPlanModeSession, setCommanderPlanModeSession] = useState<string | null>(null)
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

  // Local helper to apply project activation consistently
  const applyActiveProject = async (path: string, options: { initializeBackend?: boolean } = {}) => {
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
        console.warn('repository_is_empty check failed:', e)
      }
    } catch (error) {
      console.error('Failed to activate project:', error)
    }
  }

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
  }, [])


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
        void handleCancelSession(hasUncommittedChanges)
      } else if (action === 'delete-plan') {
        setDeletePlanModalOpen(true)
      }
    }

    window.addEventListener('schaltwerk:session-action' as any, handleSessionAction)
    return () => window.removeEventListener('schaltwerk:session-action' as any, handleSessionAction)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modifierKey = isMac ? e.metaKey : e.ctrlKey

      if (modifierKey && e.key === 'n') {
        // Don't interfere if a modal is already open or if we're typing in an input
        const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'

        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          // Store current focus before opening modal
          previousFocusRef.current = document.activeElement
          setNewSessionOpen(true)
        }
      }
      // New Plan shortcut: Cmd+Shift+N (deterministic open-as-plan)
      if (modifierKey && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
          // Store current focus before opening modal
          previousFocusRef.current = document.activeElement
          setOpenAsDraft(true)
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
        // Store current focus before opening modal
        previousFocusRef.current = document.activeElement
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
    const handleOpenDiffFile = (e: any) => {
      const filePath = e?.detail?.filePath as string | null
      setSelectedDiffFile(filePath || null)
      setIsDiffViewerOpen(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('global-new-session-shortcut', handleGlobalNewSession)
    window.addEventListener('global-kanban-shortcut', handleGlobalKanban)
    window.addEventListener('schaltwerk:open-diff-view' as any, handleOpenDiffView)
    window.addEventListener('schaltwerk:open-diff-file' as any, handleOpenDiffFile)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('global-new-session-shortcut', handleGlobalNewSession)
      window.removeEventListener('global-kanban-shortcut', handleGlobalKanban)
      window.removeEventListener('schaltwerk:open-diff-view' as any, handleOpenDiffView)
      window.removeEventListener('schaltwerk:open-diff-file' as any, handleOpenDiffFile)
    }
  }, [newSessionOpen, cancelModalOpen, increaseFontSizes, decreaseFontSizes, resetFontSizes])

  // Open NewSessionModal directly in plan mode when requested
  useEffect(() => {
    const handler = () => {
      previousFocusRef.current = document.activeElement
      setOpenAsDraft(true)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-plan', handler as any)
    return () => window.removeEventListener('schaltwerk:new-plan', handler as any)
  }, [])
  
  // Auto-enter plan mode when a new plan is created
  useEffect(() => {
    const handlePlanCreated = (event: CustomEvent<{ name: string }>) => {
      if (selection.kind === 'orchestrator') {
        // Automatically switch to the newly created plan in plan mode
        setCommanderPlanModeSession(event.detail.name)
      }
    }
    window.addEventListener('schaltwerk:plan-created' as any, handlePlanCreated)
    return () => window.removeEventListener('schaltwerk:plan-created' as any, handlePlanCreated)
  }, [selection])
  
  // Handle MCP plan updates - detect new plans and focus them in plan mode
  useEffect(() => {
    const handleSessionsRefreshed = () => {
      // Check if we're in orchestrator and plan mode
      if (selection.kind === 'orchestrator' && commanderPlanModeSession) {
        // Check if a new plan was created that we should focus
        const planSessions = sessions.filter(session => 
          session.info.status === 'plan' || session.info.session_state === 'plan'
        )
        
        // If we don't have a valid plan selected but plans exist, select the first one
        if (!planSessions.find(p => p.info.session_id === commanderPlanModeSession) && planSessions.length > 0) {
          // The current plan doesn't exist anymore, switch to the newest plan
          const newestPlan = planSessions.sort((a, b) => {
            const aTime = new Date(a.info.created_at || '').getTime()
            const bTime = new Date(b.info.created_at || '').getTime()
            return bTime - aTime  // Sort newest first
          })[0]
          setCommanderPlanModeSession(newestPlan.info.session_id)
        }
      }
    }
    
    // Use Tauri's listen for the sessions-refreshed event
    const unlisten = listen('schaltwerk:sessions-refreshed', handleSessionsRefreshed)
    
    return () => {
      unlisten.then(unlistenFn => unlistenFn())
    }
  }, [selection, commanderPlanModeSession, sessions])
  
  // Open NewSessionModal for new agent when requested
  useEffect(() => {
    const handler = () => {
      previousFocusRef.current = document.activeElement
      setOpenAsDraft(false)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-session', handler as any)
    return () => window.removeEventListener('schaltwerk:new-session', handler as any)
  }, [])

  // Open Start Agent modal prefilled from an existing plan
  useEffect(() => {
    const handler = async (event: any) => {
      console.log('[App] Received start-agent-from-plan event:', event?.detail)
      const name = event?.detail?.name as string | undefined
      if (!name) {
        console.warn('[App] No name provided in start-agent-from-plan event')
        return
      }
      // Store focus and open modal
      previousFocusRef.current = document.activeElement
      
      // Notify modal that prefill is coming
      window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill-pending'))
      
      // Fetch plan content first, then open modal with prefilled data
      console.log('[App] Fetching session data for prefill:', name)
      const prefillData = await fetchSessionForPrefill(name)
      console.log('[App] Fetched prefill data:', prefillData)
      
      // Open modal after data is ready
      setNewSessionOpen(true)
      setStartFromDraftName(name)
      
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
    window.addEventListener('schaltwerk:start-agent-from-plan' as any, handler)
    return () => window.removeEventListener('schaltwerk:start-agent-from-plan' as any, handler)
  }, [fetchSessionForPrefill])

  // Handle entering plan mode
  useEffect(() => {
    const handleEnterPlanMode = (event: CustomEvent<{ sessionName: string }>) => {
      const { sessionName } = event.detail
      if (sessionName && selection.kind === 'orchestrator') {
        setCommanderPlanModeSession(sessionName)
      }
    }
    
    window.addEventListener('schaltwerk:enter-plan-mode' as any, handleEnterPlanMode)
    return () => window.removeEventListener('schaltwerk:enter-plan-mode' as any, handleEnterPlanMode)
  }, [selection])
  
  // Handle exiting plan mode
  const handleExitPlanMode = useCallback(() => {
    setCommanderPlanModeSession(null)
  }, [])
  
  // Exit plan mode if selection changes away from orchestrator
  useEffect(() => {
    if (selection.kind !== 'orchestrator') {
      setCommanderPlanModeSession(null)
    }
  }, [selection])
  
  // Handle keyboard shortcut for plan mode (Cmd+Shift+P in orchestrator)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        if (selection.kind === 'orchestrator') {
          e.preventDefault()
          if (commanderPlanModeSession) {
            // Exit plan mode
            setCommanderPlanModeSession(null)
          } else {
            // Enter plan mode with first available plan
            const planSessions = sessions.filter(session => 
              session.info.status === 'plan' || session.info.session_state === 'plan'
            )
            if (planSessions.length > 0) {
              setCommanderPlanModeSession(planSessions[0].info.session_id)
            } else {
              // No plans available, create a new one
              window.dispatchEvent(new CustomEvent('schaltwerk:new-plan'))
            }
          }
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, commanderPlanModeSession, sessions])

  const handleCancelSession = async (_force: boolean) => {
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
  }

  const handleDeletePlan = async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke('schaltwerk_core_cancel_session', {
        name: currentSession.name
      })
      setDeletePlanModalOpen(false)
      // Reload sessions to update the list
      await invoke('schaltwerk_core_list_enriched_sessions')
    } catch (error) {
      console.error('Failed to delete plan:', error)
      alert(`Failed to delete plan: ${error}`)
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
    isPlan?: boolean
    draftContent?: string
  }) => {
    try {
      // If starting from an existing plan via the modal, convert that plan to active
      if (!data.isPlan && startFromDraftName && startFromDraftName === data.name) {
        // Ensure the plan content reflects latest prompt before starting
        const contentToUse = data.prompt || ''
        if (contentToUse.trim().length > 0) {
          await invoke('schaltwerk_core_update_plan_content', {
            name: data.name,
            content: contentToUse,
          })
        }
        // Start the plan session (transitions plan -> active and creates worktree)
        await invoke('schaltwerk_core_start_draft_session', {
          name: data.name,
          baseBranch: data.baseBranch || null,
        })
        setNewSessionOpen(false)
        setStartFromDraftName(null)

        // Small delay to ensure sessions list is updated
        await new Promise(resolve => setTimeout(resolve, 200))

        // Get the started session to get correct worktree path and state
        const sessionData = await invoke('schaltwerk_core_get_session', { name: data.name }) as any

        // Switch to the now-running session - the SelectionContext will handle the state transition
        // Backend will handle agent start automatically
        await setSelection({
          kind: 'session',
          payload: data.name,
          worktreePath: sessionData.worktree_path,
          sessionState: 'running' // Plan has been started, it's now running
        })
        return
      }

      if (data.isPlan) {
        // Create plan session
        await invoke('schaltwerk_core_create_draft_session', {
          name: data.name,
          planContent: data.draftContent || '',
        })
        setNewSessionOpen(false)

        // Get the created session to get the correct worktree path
        const sessionData = await invoke('schaltwerk_core_get_session', { name: data.name }) as any

        // If in orchestrator, automatically enter plan mode with the new plan
        if (selection.kind === 'orchestrator') {
          setCommanderPlanModeSession(data.name)
        } else {
          // Otherwise switch to the new plan session
          await setSelection({
            kind: 'session',
            payload: data.name,
            worktreePath: sessionData.worktree_path
          })
        }
        
        // Dispatch event for other components to know a plan was created
        window.dispatchEvent(new CustomEvent('schaltwerk:plan-created', {
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
        const sessionData = await invoke('schaltwerk_core_get_session', { name: data.name }) as any

        // Switch to the new session immediately - context handles terminal creation and Claude start
        await setSelection({
          kind: 'session',
          payload: data.name,
          worktreePath: sessionData.worktree_path
        })
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

    // Remove the tab
    const newTabs = openTabs.filter(tab => tab.projectPath !== path)
    setOpenTabs(newTabs)

    // If this was the active tab, handle navigation
    if (path === activeTabPath) {
      if (newTabs.length > 0) {
        // Switch to adjacent tab
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        setActiveTabPath(newActiveTab.projectPath)
        setProjectPath(newActiveTab.projectPath)
      } else {
        // No more tabs, go home
        handleGoHome()
      }
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
    <>
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
        isPlanModeActive={!!commanderPlanModeSession}
        onTogglePlanMode={() => {
          if (commanderPlanModeSession) {
            setCommanderPlanModeSession(null)
          } else {
            // Select the first available plan
            const planSessions = sessions.filter(session => 
              session.info.status === 'plan' || session.info.session_state === 'plan'
            )
            if (planSessions.length > 0) {
              setCommanderPlanModeSession(planSessions[0].info.session_id)
            } else {
              // No plans available, could show a message or create a new plan
              window.dispatchEvent(new CustomEvent('schaltwerk:new-plan'))
            }
          }
        }}
      />

      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <div className="pt-[32px] h-full">
          <HomeScreen onOpenProject={handleOpenProject} />
        </div>
      )}

      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
        <>
          <Split className="h-full w-full flex pt-[32px]" sizes={[20, 80]} minSize={[240, 400]} gutterSize={6}>
            <div className="h-full border-r overflow-y-auto" style={{ backgroundColor: theme.colors.background.secondary, borderRightColor: theme.colors.border.default }} data-testid="sidebar">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-y-auto">
                  <Sidebar 
                    isDiffViewerOpen={isDiffViewerOpen} 
                    openTabs={openTabs}
                    onSelectPrevProject={handleSelectPrevProject}
                    onSelectNextProject={handleSelectNextProject}
                  />
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
                      setOpenAsDraft(true)
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
                    title="Create plan (⇧⌘N)"
                  >
                    <span>Create Plan</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="relative h-full">
              {/* Show Plan Mode Layout when active in orchestrator */}
              {selection.kind === 'orchestrator' && commanderPlanModeSession ? (
                <PlanModeLayout
                  sessionName={commanderPlanModeSession}
                  onExit={handleExitPlanMode}
                  onSwitchPlan={(newPlanName) => setCommanderPlanModeSession(newPlanName)}
                />
              ) : (
                <>
                  {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
                  <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
                  <Split className="h-full w-full flex" sizes={[70, 30]} minSize={[400, 280]} gutterSize={8}>
                    <main className="h-full" style={{ backgroundColor: theme.colors.background.primary }} data-testid="terminal-grid">
                      <TerminalGrid />
                    </main>
                    <section className="overflow-hidden">
                      <RightPanelTabs onFileSelect={handleFileSelect} />
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
              setNewSessionOpen(false)
              setOpenAsDraft(false)
              setStartFromDraftName(null)
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
              <DeletePlanConfirmation
                open={deletePlanModalOpen}
                displayName={currentSession.displayName}
                onConfirm={handleDeletePlan}
                onCancel={() => setDeletePlanModalOpen(false)}
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
    </>
  )
}// Test comment added to main
