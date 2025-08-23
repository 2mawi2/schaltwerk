import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import { UnifiedDiffModal } from './components/diff/UnifiedDiffModal'
import Split from 'react-split'
import { NewSessionModal } from './components/modals/NewSessionModal'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { DeleteDraftConfirmation } from './components/modals/DeleteDraftConfirmation'
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
  const { increaseFontSizes, decreaseFontSizes, resetFontSizes } = useFontSize()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [deleteDraftModalOpen, setDeleteDraftModalOpen] = useState(false)
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
  const isKanbanOpenRef = useRef(false)
  
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
      } else if (action === 'delete-draft') {
        setDeleteDraftModalOpen(true)
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
          setNewSessionOpen(true)
        }
      }
      // New Draft shortcut: Cmd+Shift+N (deterministic open-as-draft)
      if (modifierKey && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                               document.activeElement?.tagName === 'TEXTAREA' ||
                               document.activeElement?.getAttribute('contenteditable') === 'true'
        if (!newSessionOpen && !cancelModalOpen && !isInputFocused) {
          e.preventDefault()
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

  // Open NewSessionModal directly in draft mode when requested
  useEffect(() => {
    const handler = () => {
      setOpenAsDraft(true)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-draft', handler as any)
    return () => window.removeEventListener('schaltwerk:new-draft', handler as any)
  }, [])
  
  // Open NewSessionModal for new task when requested
  useEffect(() => {
    const handler = () => {
      setOpenAsDraft(false)
      setNewSessionOpen(true)
    }
    window.addEventListener('schaltwerk:new-session', handler as any)
    return () => window.removeEventListener('schaltwerk:new-session', handler as any)
  }, [])

  // Open Start Task modal prefilled from an existing draft
  useEffect(() => {
    const handler = (event: any) => {
      const name = event?.detail?.name as string | undefined
      if (!name) return
      // Open modal first
      setNewSessionOpen(true)
      setStartFromDraftName(name)
      // Fetch draft content and parent branch, then prefill modal
      ;(async () => {
        try {
          const sessionData = await invoke<any>('para_core_get_session', { name })
          const text: string = sessionData?.draft_content ?? sessionData?.initial_prompt ?? ''
          const parentBranch: string | undefined = sessionData?.parent_branch || undefined
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill', {
              detail: {
                name,
                taskContent: text,
                baseBranch: parentBranch,
                lockName: true,
                fromDraft: true,
              }
            }))
          }, 0)
        } catch (error) {
          console.error('Failed to prefill from draft:', error)
        }
      })()
    }
    window.addEventListener('schaltwerk:start-task-from-draft' as any, handler)
    return () => window.removeEventListener('schaltwerk:start-task-from-draft' as any, handler)
  }, [])


  const handleCancelSession = async (_force: boolean) => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke('para_core_cancel_session', {
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

  const handleDeleteDraft = async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await invoke('para_core_cancel_session', {
        name: currentSession.name
      })
      setDeleteDraftModalOpen(false)
      // Reload sessions to update the list
      await invoke('para_core_list_enriched_sessions')
    } catch (error) {
      console.error('Failed to delete draft:', error)
      alert(`Failed to delete draft: ${error}`)
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
    isDraft?: boolean
    draftContent?: string
  }) => {
    try {
      // If starting from an existing draft via the modal, convert that draft to active
      if (!data.isDraft && startFromDraftName && startFromDraftName === data.name) {
        // Ensure the draft content reflects latest prompt before starting
        const contentToUse = data.prompt || ''
        if (contentToUse.trim().length > 0) {
          await invoke('para_core_update_draft_content', {
            name: data.name,
            content: contentToUse,
          })
        }
        // Start the draft session (transitions draft -> active and creates worktree)
        await invoke('para_core_start_draft_session', {
          name: data.name,
          baseBranch: data.baseBranch || null,
        })
        setNewSessionOpen(false)
        setStartFromDraftName(null)

        // Get the started session to get correct worktree path and state
        const sessionData = await invoke('para_core_get_session', { name: data.name }) as any

        // Switch to the session - backend will handle agent start
        // Important: pass sessionState as 'running' since we just started the draft
        await setSelection({
          kind: 'session',
          payload: data.name,
          worktreePath: sessionData.worktree_path,
          sessionState: 'running' // Draft has been started, it's now running
        })
        return
      }

      if (data.isDraft) {
        // Create draft session
        await invoke('para_core_create_draft_session', {
          name: data.name,
          draftContent: data.draftContent || '',
        })
        setNewSessionOpen(false)

        // Get the created session to get the correct worktree path
        const sessionData = await invoke('para_core_get_session', { name: data.name }) as any

        // Switch to the new draft session - no agent will start
        await setSelection({
          kind: 'session',
          payload: data.name,
          worktreePath: sessionData.worktree_path
        })
      } else {
        // Create regular session
        await invoke('para_core_create_session', {
          name: data.name,
          prompt: data.prompt || null,
          baseBranch: data.baseBranch || null,
          userEditedName: data.userEditedName ?? false,
        })
        setNewSessionOpen(false)

        // Get the created session to get the correct worktree path
        const sessionData = await invoke('para_core_get_session', { name: data.name }) as any

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

  const handleSelectTab = async (path: string) => {
    console.log('handleSelectTab called with path:', path)
    console.log('Current activeTabPath:', activeTabPath)
    console.log('Current projectPath from context:', projectPath)

    // Ensure backend knows about the project switch
    try {
      await invoke('initialize_project', { path })
      console.log('Backend initialized successfully for:', path)
    } catch (error) {
      console.error('Failed to switch project in backend:', error)
    }

    setActiveTabPath(path)
    setProjectPath(path)
    setShowHome(false)

    console.log('State updated - new activeTabPath should be:', path)
  }

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
        <div className="pt-[28px] h-full">
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
      />

      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <div className="pt-[28px] h-full">
          <HomeScreen onOpenProject={handleOpenProject} />
        </div>
      )}

      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
        <>
          <Split className="h-full w-full flex pt-[28px]" sizes={[20, 80]} minSize={[240, 400]} gutterSize={6}>
            <div className="h-full bg-panel border-r border-slate-800 overflow-y-auto" data-testid="sidebar">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-y-auto">
                  <Sidebar isDiffViewerOpen={isDiffViewerOpen} />
                </div>
                <div className="p-2 border-t border-slate-800 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNewSessionOpen(true)}
                    className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between"
                    title="Start new task (⌘N)"
                  >
                    <span>Start new task</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                  </button>
                  <button
                    onClick={() => { setOpenAsDraft(true); setNewSessionOpen(true) }}
                    className="w-full bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between border border-amber-700/40"
                    title="Create draft (⇧⌘N)"
                  >
                    <span>New draft</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="relative h-full">
              {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
              <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
              <Split className="h-full w-full flex" sizes={[70, 30]} minSize={[400, 280]} gutterSize={8}>
                <main className="bg-slate-950 h-full" data-testid="terminal-grid">
                  <TerminalGrid />
                </main>
                <section className="overflow-hidden">
                  <RightPanelTabs onFileSelect={handleFileSelect} />
                </section>
              </Split>
            </div>
          </Split>

          <NewSessionModal
            open={newSessionOpen}
            initialIsDraft={openAsDraft}
            onClose={() => { setNewSessionOpen(false); setOpenAsDraft(false); setStartFromDraftName(null) }}
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
              <DeleteDraftConfirmation
                open={deleteDraftModalOpen}
                displayName={currentSession.displayName}
                onConfirm={handleDeleteDraft}
                onCancel={() => setDeleteDraftModalOpen(false)}
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
