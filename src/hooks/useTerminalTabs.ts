import { useState, useCallback, useEffect } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { TabInfo } from '../types/terminalTabs'
import { useProject } from '../contexts/ProjectContext'
import { TERMINAL_RESET_EVENT, TerminalResetDetail } from '../types/terminalEvents'

interface SessionTabState {
  activeTab: number
  tabs: TabInfo[]
  maxTabs: number
}

interface UseTerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  maxTabs?: number
  sessionName?: string | null
}

const DEFAULT_MAX_TABS = 6

// Global state to persist tabs across component remounts
const globalTabState = new Map<string, SessionTabState>()
const globalTerminalCreated = new Set<string>()

export function useTerminalTabs({ 
  baseTerminalId, 
  workingDirectory,
  maxTabs = DEFAULT_MAX_TABS,
  sessionName = null,
}: UseTerminalTabsProps) {
  // Use baseTerminalId as session key to maintain separate state per session
  const sessionKey = baseTerminalId
  
  const [, forceUpdate] = useState(0)
  const triggerUpdate = useCallback(() => {
    forceUpdate(prev => prev + 1)
  }, [])

  const { projectPath } = useProject()

  const registerTerminalSession = useCallback(async (terminalId: string) => {
    if (!projectPath) return
    try {
      await invoke(TauriCommands.RegisterSessionTerminals, {
        projectId: projectPath,
        sessionId: sessionName ?? null,
        terminalIds: [terminalId],
      })
    } catch (error) {
      logger.warn(`[useTerminalTabs] Failed to register terminal ${terminalId}`, error)
    }
  }, [projectPath, sessionName])
  
  // Initialize session state if it doesn't exist
  if (!globalTabState.has(sessionKey)) {
    globalTabState.set(sessionKey, {
      activeTab: 0,
      tabs: [{
        index: 0,
        terminalId: `${baseTerminalId}-0`,
        label: 'Terminal 1'
      }],
      maxTabs
    })
  }

  // Handle reset events by clearing global state for this session
  const shouldHandleReset = useCallback((detail?: TerminalResetDetail) => {
    if (!detail) return false
    if (detail.kind === 'orchestrator') {
      return sessionName === null
    }
    return sessionName === detail.sessionId
  }, [sessionName])

  useEffect(() => {
    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<TerminalResetDetail>).detail
      if (!shouldHandleReset(detail)) return
      // Clear all state for this session
      const currentState = globalTabState.get(sessionKey)
      if (currentState) {
        // Clean up terminals
        currentState.tabs.forEach(tab => {
          globalTerminalCreated.delete(tab.terminalId)
        })
      }
      
      // Reset to initial state
      globalTabState.set(sessionKey, {
        activeTab: 0,
        tabs: [{
          index: 0,
          terminalId: `${baseTerminalId}-0`,
          label: 'Terminal 1'
        }],
        maxTabs
      })
      
      triggerUpdate()
    }

    window.addEventListener(TERMINAL_RESET_EVENT, handleReset)
    return () => window.removeEventListener(TERMINAL_RESET_EVENT, handleReset)
  }, [sessionKey, baseTerminalId, maxTabs, triggerUpdate, shouldHandleReset])

  const sessionTabs = globalTabState.get(sessionKey)!

  const createTerminal = useCallback(async (terminalId: string) => {
    if (globalTerminalCreated.has(terminalId)) {
      return
    }

    const sanitizedCwd = workingDirectory.trim()
    if (!sanitizedCwd) {
      logger.debug(`[useTerminalTabs] Deferring creation of ${terminalId} until working directory is ready`)
      return
    }

    try {
      const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: terminalId })
      if (!exists) {
        await invoke(TauriCommands.CreateTerminal, { id: terminalId, cwd: sanitizedCwd })
      }
      globalTerminalCreated.add(terminalId)
    } catch (error) {
      logger.error(`Failed to create terminal ${terminalId}:`, error)
      throw error
    }
  }, [workingDirectory])

   const addTab = useCallback(async () => {
     if (sessionTabs.tabs.length >= sessionTabs.maxTabs) {
       return
     }

     const newIndex = Math.max(...sessionTabs.tabs.map(t => t.index)) + 1
     const newTerminalId = `${baseTerminalId}-${newIndex}`
     
     // Find the lowest available label number
     const existingNumbers = sessionTabs.tabs.map(t => parseInt(t.label.replace('Terminal ', '')))
     let labelNumber = 1
     while (existingNumbers.includes(labelNumber)) {
       labelNumber++
     }

     try {
       await createTerminal(newTerminalId)
       await registerTerminalSession(newTerminalId)

       const newTab: TabInfo = {
         index: newIndex,
         terminalId: newTerminalId,
         label: `Terminal ${labelNumber}`
       }

       const updatedState = {
         ...sessionTabs,
         tabs: [...sessionTabs.tabs, newTab],
         activeTab: newIndex
       }
       globalTabState.set(sessionKey, updatedState)
       triggerUpdate()

         // Focus the newly created terminal tab
         if (typeof window !== 'undefined') {
           requestAnimationFrame(() => {
             window.dispatchEvent(new CustomEvent('schaltwerk:focus-terminal', {
               detail: { terminalId: newTerminalId, focusType: 'terminal' }
             }))
           })
         }
     } catch (error) {
       logger.error('Failed to add new tab:', error)
     }
   }, [sessionTabs, baseTerminalId, createTerminal, registerTerminalSession, sessionKey, triggerUpdate])

  const closeTab = useCallback(async (tabIndex: number) => {
    if (sessionTabs.tabs.length <= 1) {
      return
    }

    const tabToClose = sessionTabs.tabs.find(t => t.index === tabIndex)
    if (!tabToClose) return

    try {
      await invoke(TauriCommands.CloseTerminal, { id: tabToClose.terminalId })
      globalTerminalCreated.delete(tabToClose.terminalId)

      const newTabs = sessionTabs.tabs.filter(t => t.index !== tabIndex)
      let newActiveTab = sessionTabs.activeTab
      
      if (sessionTabs.activeTab === tabIndex) {
        const currentTabPosition = sessionTabs.tabs.findIndex(t => t.index === tabIndex)
        if (currentTabPosition > 0) {
          newActiveTab = sessionTabs.tabs[currentTabPosition - 1].index
        } else if (newTabs.length > 0) {
          newActiveTab = newTabs[0].index
        }
      }

      const updatedState = {
        ...sessionTabs,
        tabs: newTabs,
        activeTab: newActiveTab
      }
      globalTabState.set(sessionKey, updatedState)
      triggerUpdate()
    } catch (error) {
      logger.error(`Failed to close terminal ${tabToClose.terminalId}:`, error)
    }
  }, [sessionTabs, sessionKey, triggerUpdate])

  const setActiveTab = useCallback((tabIndex: number) => {
    const updatedState = {
      ...sessionTabs,
      activeTab: tabIndex
    }
    globalTabState.set(sessionKey, updatedState)
    triggerUpdate()
  }, [sessionTabs, sessionKey, triggerUpdate])

  // Create initial terminal when component mounts
  useEffect(() => {
    const initialTab = sessionTabs.tabs[0]
    if (!initialTab) return
    const ensureInitial = async () => {
      try {
        await createTerminal(initialTab.terminalId)
        await registerTerminalSession(initialTab.terminalId)
      } catch (err) {
        logger.error('[useTerminalTabs] Failed to initialize initial terminal', err)
      }
    }
    ensureInitial()
  }, [createTerminal, registerTerminalSession, sessionTabs.tabs])

  return {
    tabs: sessionTabs.tabs,
    activeTab: sessionTabs.activeTab,
    canAddTab: sessionTabs.tabs.length < sessionTabs.maxTabs,
    addTab,
    closeTab,
    setActiveTab
  }
}
