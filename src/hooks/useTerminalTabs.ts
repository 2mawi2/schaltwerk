import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface TabInfo {
  index: number
  terminalId: string
  label: string
}

interface SessionTabState {
  activeTab: number
  tabs: TabInfo[]
  maxTabs: number
}

interface UseTerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  maxTabs?: number
}

const DEFAULT_MAX_TABS = 6

// Global state to persist tabs across component remounts
const globalTabState = new Map<string, SessionTabState>()
const globalTerminalCreated = new Set<string>()

export function useTerminalTabs({ 
  baseTerminalId, 
  workingDirectory,
  maxTabs = DEFAULT_MAX_TABS 
}: UseTerminalTabsProps) {
  // Use baseTerminalId as session key to maintain separate state per session
  const sessionKey = baseTerminalId
  
  const [, forceUpdate] = useState(0)
  const triggerUpdate = useCallback(() => {
    forceUpdate(prev => prev + 1)
  }, [])
  
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
  useEffect(() => {
    const handleReset = () => {
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

    window.addEventListener('schaltwerk:reset-terminals', handleReset)
    return () => window.removeEventListener('schaltwerk:reset-terminals', handleReset)
  }, [sessionKey, baseTerminalId, maxTabs, triggerUpdate])

  const sessionTabs = globalTabState.get(sessionKey)!

  const createTerminal = useCallback(async (terminalId: string) => {
    if (globalTerminalCreated.has(terminalId)) {
      return
    }

    try {
      const exists = await invoke<boolean>('terminal_exists', { id: terminalId })
      if (!exists) {
        await invoke('create_terminal', { id: terminalId, cwd: workingDirectory })
      }
      globalTerminalCreated.add(terminalId)
    } catch (error) {
      console.error(`Failed to create terminal ${terminalId}:`, error)
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
       console.error('Failed to add new tab:', error)
     }
   }, [sessionTabs, baseTerminalId, createTerminal, sessionKey, triggerUpdate])

  const closeTab = useCallback(async (tabIndex: number) => {
    if (sessionTabs.tabs.length <= 1) {
      return
    }

    const tabToClose = sessionTabs.tabs.find(t => t.index === tabIndex)
    if (!tabToClose) return

    try {
      await invoke('close_terminal', { id: tabToClose.terminalId })
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
      console.error(`Failed to close terminal ${tabToClose.terminalId}:`, error)
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
    if (initialTab && !globalTerminalCreated.has(initialTab.terminalId)) {
      createTerminal(initialTab.terminalId).catch(console.error)
    }
  }, [createTerminal, sessionTabs.tabs])

  return {
    tabs: sessionTabs.tabs,
    activeTab: sessionTabs.activeTab,
    canAddTab: sessionTabs.tabs.length < sessionTabs.maxTabs,
    addTab,
    closeTab,
    setActiveTab
  }
}