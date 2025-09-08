import { useState, useEffect, useCallback } from 'react'
import { Selection } from '../contexts/SelectionContext'
import { EnrichedSession } from '../types/session'
import { isSpec } from '../utils/sessionFilters'
import { FilterMode } from '../types/sessionFilters'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { logger } from '../utils/logger'

function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export interface SpecModeState {
  isActive: boolean
  currentSpec: string | null
  sidebarFilter: 'specs-only' | 'all' | string
  previousSelection?: Selection
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
    const key = 'default' // Will be updated when projectPath is available
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
  }, [setFilterMode, setSelection, selection, projectPath])

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

  // Listen for spec creation events (for potential future use)
  useEffect(() => {
    const handleSpecCreated = (event: CustomEvent<{ name: string }>) => {
      // Spec created - no automatic spec mode activation
      logger.info('[useSpecMode] Spec created:', event.detail.name)
    }
    window.addEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
    return () => window.removeEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
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
  }, [selection, commanderSpecModeSession, sessions])

  // Handle entering spec mode
  useEffect(() => {
    const handleEnterSpecMode = (event: CustomEvent<{ sessionName: string }>) => {
      const { sessionName } = event.detail
      if (sessionName) {
        // Enter spec mode regardless of current selection - we'll switch to orchestrator automatically
        enterSpecMode(sessionName, currentFilterMode)
      }
    }

    window.addEventListener('schaltwerk:enter-spec-mode', handleEnterSpecMode as EventListener)
    return () => window.removeEventListener('schaltwerk:enter-spec-mode', handleEnterSpecMode as EventListener)
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
  }, [projectPath, previousSelection, previousFilterMode, setSelection, setFilterMode])
  
  // Listen for exit spec mode event
  useEffect(() => {
    const handleExitEvent = async () => {
      await handleExitSpecMode()
    }
    window.addEventListener('schaltwerk:exit-spec-mode', handleExitEvent)
    return () => window.removeEventListener('schaltwerk:exit-spec-mode', handleExitEvent)
  }, [handleExitSpecMode])

  // Handle keyboard shortcut for spec mode (Cmd+Shift+S from anywhere)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault()
        
        // If already in spec mode and in orchestrator, exit spec mode
        if (commanderSpecModeSession && selection.kind === 'orchestrator') {
          await handleExitSpecMode()
        } else {
          // Find specs from ALL sessions, not just currently filtered ones
          // This allows entering spec mode even when specs are filtered out
          const specSessions = sessions.filter(session => isSpec(session.info))
          const specToSelect = getSpecToSelect(specSessions, lastSelectedSpec)
          if (specToSelect) {
            await enterSpecMode(specToSelect, currentFilterMode)
          } else {
            logger.info('[useSpecMode] No specs found, creating new spec')
            // Switch to orchestrator first before creating spec
            if (selection.kind !== 'orchestrator') {
              await setSelection({ kind: 'orchestrator' })
              window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
            } else {
              window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, commanderSpecModeSession, sessions, enterSpecMode, setSelection, handleExitSpecMode, lastSelectedSpec, currentFilterMode])

  // Helper function to handle spec deletion
  const handleSpecDeleted = useCallback((sessionName: string) => {
    if (commanderSpecModeSession === sessionName) {
      setCommanderSpecModeSession(null)
    }
  }, [commanderSpecModeSession])

  // Helper function to handle spec conversion
  const handleSpecConverted = useCallback((sessionName: string) => {
    if (commanderSpecModeSession === sessionName) {
      setCommanderSpecModeSession(null)
    }
  }, [commanderSpecModeSession])

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
        window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
      }
    }
  }, [commanderSpecModeSession, sessions, enterSpecMode, selection.kind, setSelection, handleExitSpecMode, lastSelectedSpec, currentFilterMode])

  // Build spec mode state object
  const specModeState: SpecModeState = {
    isActive: !!commanderSpecModeSession,
    currentSpec: commanderSpecModeSession,
    sidebarFilter: specModeSidebarFilter,
    previousSelection
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
    setPreviousSelection
  }
}