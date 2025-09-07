import { useState, useEffect, useCallback } from 'react'
import { Selection } from '../contexts/SelectionContext'
import { EnrichedSession } from '../types/session'
import { SchaltEvent, listenEvent } from '../common/eventSystem'

function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

interface UseSpecModeProps {
  projectPath: string | null
  selection: Selection
  sessions: EnrichedSession[]
}

export function useSpecMode({ projectPath, selection, sessions }: UseSpecModeProps) {
  // Initialize spec mode state from sessionStorage
  const [commanderSpecModeSession, setCommanderSpecModeSession] = useState<string | null>(() => {
    const key = 'default' // Will be updated when projectPath is available
    return sessionStorage.getItem(`schaltwerk:spec-mode:${key}`)
  })

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
  }, [projectPath, sessions, commanderSpecModeSession])
  
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

  // Auto-enter spec mode when a new spec is created
  useEffect(() => {
    const handleSpecCreated = (event: CustomEvent<{ name: string }>) => {
      if (selection.kind === 'orchestrator') {
        setCommanderSpecModeSession(event.detail.name)
      }
    }
    window.addEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
    return () => window.removeEventListener('schaltwerk:spec-created', handleSpecCreated as EventListener)
  }, [selection])
  
  // Handle MCP spec updates - detect new specs and focus them in spec mode
  useEffect(() => {
    const handleSessionsRefreshed = () => {
      if (selection.kind === 'orchestrator' && commanderSpecModeSession) {
        const specSessions = sessions.filter(session =>
          session.info.status === 'spec' || session.info.session_state === 'spec'
        )

        if (!specSessions.find(p => p.info.session_id === commanderSpecModeSession) && specSessions.length > 0) {
          const newestSpec = specSessions.sort((a, b) => {
            const aTime = new Date(a.info.created_at || '').getTime()
            const bTime = new Date(b.info.created_at || '').getTime()
            return bTime - aTime
          })[0]
          setCommanderSpecModeSession(newestSpec.info.session_id)
        }
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
    if (projectPath) {
      const projectId = getBasename(projectPath)
      sessionStorage.removeItem(`schaltwerk:spec-mode:${projectId}`)
    }
  }, [projectPath])

  // Handle keyboard shortcut for spec mode (Cmd+Shift+S in orchestrator)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        if (selection.kind === 'orchestrator') {
          e.preventDefault()
          if (commanderSpecModeSession) {
            setCommanderSpecModeSession(null)
          } else {
            const specSessions = sessions.filter(session =>
              session.info.status === 'spec' || session.info.session_state === 'spec'
            )
            if (specSessions.length > 0) {
              setCommanderSpecModeSession(specSessions[0].info.session_id)
            } else {
              window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, commanderSpecModeSession, sessions])

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
  const toggleSpecMode = useCallback(() => {
    if (commanderSpecModeSession) {
      setCommanderSpecModeSession(null)
    } else {
      const specSessions = sessions.filter(session =>
        session.info.status === 'spec' || session.info.session_state === 'spec'
      )
      if (specSessions.length > 0) {
        setCommanderSpecModeSession(specSessions[0].info.session_id)
      } else {
        window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
      }
    }
  }, [commanderSpecModeSession, sessions])

  return {
    commanderSpecModeSession,
    setCommanderSpecModeSession,
    handleExitSpecMode,
    handleSpecDeleted,
    handleSpecConverted,
    toggleSpecMode
  }
}