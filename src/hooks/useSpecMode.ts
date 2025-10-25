import { useState, useEffect, useCallback } from 'react'
import { Selection } from '../contexts/SelectionContext'
import { EnrichedSession } from '../types/session'
import { isSpec } from '../utils/sessionFilters'
import { FilterMode } from '../types/sessionFilters'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { logger } from '../utils/logger'
import { UiEvent, listenUiEvent, emitUiEvent } from '../common/uiEvents'

function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export interface SpecModeState {
  isActive: boolean
  currentSpec: string | null
  sidebarFilter: 'specs-only' | 'all' | string
  previousSelection?: Selection
  workspaceOpen: boolean
  openTabs: string[]
  activeTab: string | null
}

interface UseSpecModeProps {
  projectPath: string | null
  selection: Selection
  sessions: EnrichedSession[]
  setFilterMode: (mode: FilterMode) => void
  setSelection: (selection: Selection) => Promise<void>
  currentFilterMode?: FilterMode
}

// Helper function to determine which spec to select
export function getSpecToSelect(specSessions: EnrichedSession[], lastSelectedSpec: string | null): string | null {
  if (!specSessions.length) return null
  
  // Use last selected spec if it still exists
  if (lastSelectedSpec) {
    const existingSpec = specSessions.find(s => s.info.session_id === lastSelectedSpec)
    if (existingSpec) {
      return lastSelectedSpec
    }
  }
  
  // Otherwise use first available spec
  return specSessions[0].info.session_id
}

export function useSpecMode({ projectPath, selection, sessions, setFilterMode, setSelection, currentFilterMode }: UseSpecModeProps) {
  // Initialize spec mode state from sessionStorage
  const [commanderSpecModeSession, setCommanderSpecModeSessionInternal] = useState<string | null>(() => {
    const key = 'default'
    return sessionStorage.getItem(`schaltwerk:spec-mode:${key}`)
  })

  // Track the last selected spec (persists even when spec mode is off)
  const [lastSelectedSpec, setLastSelectedSpec] = useState<string | null>(() => {
    const key = projectPath ? getBasename(projectPath) : 'default'
    return sessionStorage.getItem(`schaltwerk:last-spec:${key}`)
  })

  // Wrap setter with debugging
  const setCommanderSpecModeSession = useCallback((newValue: string | null) => {
    logger.info('[useSpecMode] Setting spec mode session:', commanderSpecModeSession, '→', newValue)
    logger.debug('[useSpecMode] Stack trace for spec mode change')
    setCommanderSpecModeSessionInternal(newValue)
  }, [commanderSpecModeSession])

  // Track sidebar filter preference when in spec mode
  const [specModeSidebarFilter, setSpecModeSidebarFilter] = useState<'specs-only' | 'all'>('specs-only')

  // Track previous selection for restoration when exiting spec mode
  const [previousSelection, setPreviousSelection] = useState<Selection | undefined>(() => {
    const key = projectPath ? getBasename(projectPath) : 'default'
    const saved = sessionStorage.getItem(`schaltwerk:prev-selection:${key}`)
    return saved ? JSON.parse(saved) : undefined
  })

  // Track previous filter mode for restoration when exiting spec mode
  const [previousFilterMode, setPreviousFilterMode] = useState<FilterMode | undefined>(() => {
    const key = projectPath ? getBasename(projectPath) : 'default'
    const saved = sessionStorage.getItem(`schaltwerk:prev-filter:${key}`)
    return saved as FilterMode | undefined
  })

  // Workspace state for the new right panel tabs experience
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    const key = projectPath ? getBasename(projectPath) : 'default'
    const saved = sessionStorage.getItem(`schaltwerk:spec-tabs:${key}`)
    return saved ? JSON.parse(saved) : []
  })
  const [activeTab, setActiveTab] = useState<string | null>(() => {
    const key = projectPath ? getBasename(projectPath) : 'default'
    return sessionStorage.getItem(`schaltwerk:active-spec-tab:${key}`)
  })
  
  // Helper function to enter spec mode and automatically show specs
  const enterSpecMode = useCallback(async (specId: string, currentFilterMode?: FilterMode) => {
    logger.info('[useSpecMode] Entering spec mode with spec:', specId)
    
    // Save current selection before switching to spec mode (unless already in orchestrator)
    if (selection.kind !== 'orchestrator') {
      setPreviousSelection(selection)
      if (projectPath) {
        const projectId = getBasename(projectPath)
        sessionStorage.setItem(`schaltwerk:prev-selection:${projectId}`, JSON.stringify(selection))
      }
    }
    
    // Save current filter mode (always save it, including Spec)
    const filterToSave = currentFilterMode || FilterMode.All
    setPreviousFilterMode(filterToSave)
    if (projectPath) {
      const projectId = getBasename(projectPath)
      sessionStorage.setItem(`schaltwerk:prev-filter:${projectId}`, filterToSave)
    }
    
    // First switch to orchestrator if not already there
    if (selection.kind !== 'orchestrator') {
      await setSelection({ kind: 'orchestrator' })
    }
    setCommanderSpecModeSession(specId)
    setLastSelectedSpec(specId) // Remember this spec
    setFilterMode(FilterMode.Spec) // Automatically show only specs
    setSpecModeSidebarFilter('specs-only')
  }, [setFilterMode, setSelection, selection, projectPath, setCommanderSpecModeSession])

  // Temporarily disable project restoration to diagnose switching issue
  /*
  // Load spec mode state when project changes
  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    const savedSpecMode = sessionStorage.getItem(`schaltwerk:spec-mode:${projectId}`)
    if (savedSpecMode && savedSpecMode !== commanderSpecModeSession && sessions.length > 0) {
      // Validate that the saved spec still exists
      const specExists = sessions.find(session => 
        session.info.session_id === savedSpecMode && 
        (session.info.status === 'spec' || session.info.session_state === 'spec')
      )
      if (specExists) {
        logger.info('[useSpecMode] Restoring saved spec mode:', savedSpecMode)
        setCommanderSpecModeSession(savedSpecMode)
      } else {
        logger.info('[useSpecMode] Saved spec no longer exists, clearing:', savedSpecMode)
        // Saved spec no longer exists, clear from storage
        sessionStorage.removeItem(`schaltwerk:spec-mode:${projectId}`)
      }
    }
  }, [projectPath, sessions, commanderSpecModeSession])
  */
  
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
  
  // Save last selected spec to sessionStorage when it changes
  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    if (lastSelectedSpec) {
      sessionStorage.setItem(`schaltwerk:last-spec:${projectId}`, lastSelectedSpec)
    }
  }, [lastSelectedSpec, projectPath])

  // Persist workspace state to sessionStorage
  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    sessionStorage.setItem(`schaltwerk:spec-tabs:${projectId}`, JSON.stringify(openTabs))
  }, [openTabs, projectPath])

  useEffect(() => {
    if (!projectPath) return
    const projectId = getBasename(projectPath)
    if (activeTab) {
      sessionStorage.setItem(`schaltwerk:active-spec-tab:${projectId}`, activeTab)
    } else {
      sessionStorage.removeItem(`schaltwerk:active-spec-tab:${projectId}`)
    }
  }, [activeTab, projectPath])

  // Listen for spec creation events (for potential future use)
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.SpecCreated, detail => {
      logger.info('[useSpecMode] Spec created:', detail.name)
    })
    return cleanup
  }, [])
  
  // Handle MCP spec updates - only exit spec mode if current spec is deleted
  useEffect(() => {
    const handleSessionsRefreshed = () => {
      if (selection.kind === 'orchestrator' && commanderSpecModeSession) {
        const specSessions = sessions.filter(session =>
          session.info.status === 'spec' || session.info.session_state === 'spec'
        )

        // Only exit spec mode if the current spec no longer exists and there are no specs at all
        if (!specSessions.find(p => p.info.session_id === commanderSpecModeSession) && specSessions.length === 0) {
          logger.info('[useSpecMode] Current spec deleted and no specs remain, exiting spec mode')
          setCommanderSpecModeSession(null)
        }
        // If current spec is deleted but other specs exist, let user manually select a new one
        // Don't auto-switch to avoid the infinite switching issue
      }
    }

    const unlisten = listenEvent(SchaltEvent.SessionsRefreshed, handleSessionsRefreshed)

    return () => {
      unlisten.then(unlistenFn => unlistenFn())
    }
  }, [selection, commanderSpecModeSession, sessions, setCommanderSpecModeSession])

  // Handle entering spec mode
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.EnterSpecMode, detail => {
      const { sessionName } = detail
      if (sessionName) {
        enterSpecMode(sessionName, currentFilterMode)
      }
    })

    return cleanup
  }, [enterSpecMode, currentFilterMode])

  // Handle exiting spec mode
  const handleExitSpecMode = useCallback(async () => {
    setCommanderSpecModeSession(null)
    if (projectPath) {
      const projectId = getBasename(projectPath)
      sessionStorage.removeItem(`schaltwerk:spec-mode:${projectId}`)
    }
    
    // Restore previous filter mode first to ensure session visibility
    if (previousFilterMode) {
      setFilterMode(previousFilterMode)
      setPreviousFilterMode(undefined)
      if (projectPath) {
        const projectId = getBasename(projectPath)
        sessionStorage.removeItem(`schaltwerk:prev-filter:${projectId}`)
      }
    } else {
      // Default to All filter if no previous filter was saved
      setFilterMode(FilterMode.All)
    }
    
    // Then restore previous selection if available
    if (previousSelection) {
      // Small delay to ensure filter has been applied and sessions are visible
      await new Promise(resolve => setTimeout(resolve, 50))
      await setSelection(previousSelection)
      setPreviousSelection(undefined)
      if (projectPath) {
        const projectId = getBasename(projectPath)
        sessionStorage.removeItem(`schaltwerk:prev-selection:${projectId}`)
      }
    }
  }, [projectPath, previousSelection, previousFilterMode, setSelection, setFilterMode, setCommanderSpecModeSession])
  
  // Listen for exit spec mode event
  useEffect(() => {
    const handleExitEvent = async () => {
      await handleExitSpecMode()
    }
    window.addEventListener('schaltwerk:exit-spec-mode', handleExitEvent)
    return () => window.removeEventListener('schaltwerk:exit-spec-mode', handleExitEvent)
  }, [handleExitSpecMode])

  // Helper function to handle spec deletion
  const handleSpecDeleted = useCallback((sessionName: string) => {
    if (commanderSpecModeSession === sessionName) {
      setCommanderSpecModeSession(null)
    }
  }, [commanderSpecModeSession, setCommanderSpecModeSession])

  // Helper function to handle spec conversion
  const handleSpecConverted = useCallback((sessionName: string) => {
    if (commanderSpecModeSession === sessionName) {
      setCommanderSpecModeSession(null)
    }
  }, [commanderSpecModeSession, setCommanderSpecModeSession])

  // Toggle spec mode function  
  const toggleSpecMode = useCallback(async () => {
    logger.info('[useSpecMode] toggleSpecMode called, current session:', commanderSpecModeSession)
    if (commanderSpecModeSession && selection.kind === 'orchestrator') {
      await handleExitSpecMode()
      setSpecModeSidebarFilter('specs-only') // Reset filter when exiting
    } else {
      // Find specs from ALL sessions, not just currently filtered ones
      const specSessions = sessions.filter(session => isSpec(session.info))
      const specToSelect = getSpecToSelect(specSessions, lastSelectedSpec)
      if (specToSelect) {
        await enterSpecMode(specToSelect, currentFilterMode)
      } else {
        logger.info('[useSpecMode] No specs available, creating new spec')
        // Switch to orchestrator first before creating spec
        if (selection.kind !== 'orchestrator') {
          await setSelection({ kind: 'orchestrator' })
        }
        emitUiEvent(UiEvent.NewSpecRequest)
      }
    }
  }, [commanderSpecModeSession, sessions, enterSpecMode, selection.kind, setSelection, handleExitSpecMode, lastSelectedSpec, currentFilterMode])

  // Helper to open a spec in workspace
  const openSpecInWorkspace = useCallback((specId: string) => {
    setOpenTabs(prev => {
      if (prev.includes(specId)) {
        return prev
      }
      return [...prev, specId]
    })
    setActiveTab(specId)
    setWorkspaceOpen(true)
  }, [])

  // Helper to close a spec tab
  const closeSpecTab = useCallback((specId: string) => {
    setOpenTabs(prev => {
      if (!prev.includes(specId)) {
        return prev
      }

      const filtered = prev.filter(id => id !== specId)

      if (activeTab === specId) {
        setActiveTab(filtered.length > 0 ? filtered[filtered.length - 1] : null)
      }

      return filtered
    })
  }, [activeTab])

  // Prune tabs when sessions are removed
  useEffect(() => {
    const specSessionIds = sessions
      .filter(session => isSpec(session.info))
      .map(session => session.info.session_id)

    setOpenTabs(prev => {
      const filtered = prev.filter(id => specSessionIds.includes(id))

      if (filtered.length === prev.length) {
        return prev
      }

      logger.info('[useSpecMode] Pruned removed spec tabs')

      setActiveTab(currentActiveTab => {
        if (currentActiveTab && !filtered.includes(currentActiveTab)) {
          return filtered.length > 0 ? filtered[0] : null
        }
        return currentActiveTab
      })

      return filtered
    })
  }, [sessions])

  // Build spec mode state object
  const specModeState: SpecModeState = {
    isActive: !!commanderSpecModeSession,
    currentSpec: commanderSpecModeSession,
    sidebarFilter: specModeSidebarFilter,
    previousSelection,
    workspaceOpen,
    openTabs,
    activeTab
  }

  return {
    commanderSpecModeSession,
    setCommanderSpecModeSession: (value: string | null) => {
      setCommanderSpecModeSession(value)
      if (value) {
        setLastSelectedSpec(value)
      }
    },
    handleExitSpecMode,
    handleSpecDeleted,
    handleSpecConverted,
    toggleSpecMode,
    specModeState,
    setSpecModeSidebarFilter,
    setPreviousSelection,
    workspaceOpen,
    setWorkspaceOpen,
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    openSpecInWorkspace,
    closeSpecTab
  }
}
