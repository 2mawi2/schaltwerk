import { useCallback, useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { TabInfo } from '../types/terminalTabs'
import { UiEvent, TerminalResetDetail, emitUiEvent, listenUiEvent } from '../common/uiEvents'
import { bestBootstrapSize } from '../common/terminalSizeCache'
import {
  closeTerminalBackend,
  createTerminalBackend,
  terminalExistsBackend,
} from '../terminal/transport/backend'
import { releaseTerminalInstance } from '../terminal/registry/terminalRegistry'
import {
  terminalTabsAtomFamily,
  addTabActionAtom,
  removeTabActionAtom,
  setActiveTabActionAtom,
  resetTerminalTabsActionAtom,
} from '../store/atoms/terminal'

interface UseTerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  maxTabs?: number
  sessionName?: string | null
  bootstrapTopTerminalId?: string
}

const DEFAULT_MAX_TABS = 6

const globalTerminalCreated = new Set<string>()

export function useTerminalTabs({
  baseTerminalId,
  workingDirectory,
  maxTabs = DEFAULT_MAX_TABS,
  sessionName = null,
  bootstrapTopTerminalId,
}: UseTerminalTabsProps) {
  // Use Jotai atoms for tab state
  const atomState = useAtomValue(terminalTabsAtomFamily(baseTerminalId))
  const addTabAction = useSetAtom(addTabActionAtom)
  const removeTabAction = useSetAtom(removeTabActionAtom)
  const setActiveTabAction = useSetAtom(setActiveTabActionAtom)
  const resetTabsAction = useSetAtom(resetTerminalTabsActionAtom)

  // Convert atom state to TabInfo format, providing default tab if empty
  const tabs: TabInfo[] = useMemo(() => {
    if (atomState.tabs.length === 0) {
      return [{ index: 0, terminalId: baseTerminalId, label: 'Terminal 1' }]
    }
    return atomState.tabs.map((tab, idx) => ({
      index: tab.index,
      terminalId: tab.terminalId,
      label: `Terminal ${idx + 1}`,
    }))
  }, [atomState.tabs, baseTerminalId])

  const activeTab = atomState.activeTabIndex

  // Handle reset events by clearing state for this session
  const shouldHandleReset = useCallback((detail?: TerminalResetDetail) => {
    if (!detail) return false
    if (detail.kind === 'orchestrator') {
      return sessionName === null
    }
    return sessionName === detail.sessionId
  }, [sessionName])

  useEffect(() => {
    const handleReset = (detail?: TerminalResetDetail) => {
      if (!shouldHandleReset(detail)) return

      // Clean up terminals from global tracking
      tabs.forEach(tab => {
        globalTerminalCreated.delete(tab.terminalId)
        releaseTerminalInstance(tab.terminalId)
      })

      // Reset atom state
      resetTabsAction({ baseTerminalId })
    }

    const cleanup = listenUiEvent(UiEvent.TerminalReset, handleReset)
    return cleanup
  }, [baseTerminalId, tabs, resetTabsAction, shouldHandleReset])

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
      const directoryExists = await invoke<boolean>(TauriCommands.PathExists, { path: sanitizedCwd })
      if (!directoryExists) {
        logger.debug(`[useTerminalTabs] Skipping creation of ${terminalId} because ${sanitizedCwd} is not present yet`)
        return
      }

      const exists = await terminalExistsBackend(terminalId)
      if (!exists) {
        let sizeHint: { cols: number; rows: number } | null = null
        try {
          sizeHint = bestBootstrapSize({ topId: bootstrapTopTerminalId ?? terminalId })
        } catch (error) {
          logger.debug(`[useTerminalTabs] Failed to compute size hint for ${terminalId}`, error)
        }

        await createTerminalBackend({
          id: terminalId,
          cwd: sanitizedCwd,
          cols: sizeHint?.cols,
          rows: sizeHint?.rows,
        })
      }
      globalTerminalCreated.add(terminalId)
    } catch (error) {
      logger.error(`Failed to create terminal ${terminalId}:`, error)
      throw error
    }
  }, [workingDirectory, bootstrapTopTerminalId])

  const addTab = useCallback(async () => {
    if (tabs.length >= maxTabs) {
      return
    }

    // The addTabActionAtom will compute the next index based on current tabs
    // We need to predict the new terminal ID for creation
    const nextIndex = tabs.length === 0
      ? 1 // If empty, addTabActionAtom will create tab 0 first, then tab 1
      : Math.max(...tabs.map(t => t.index)) + 1
    const newTerminalId = `${baseTerminalId}-${nextIndex}`

    try {
      await createTerminal(newTerminalId)

      // Use Jotai action to add the tab
      addTabAction({ baseTerminalId, activateNew: true, maxTabs })

      // Focus the newly created terminal tab
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => {
          emitUiEvent(UiEvent.FocusTerminal, { terminalId: newTerminalId, focusType: 'terminal' })
        })
      }
    } catch (error) {
      logger.error('Failed to add new tab:', error)
    }
  }, [tabs, maxTabs, baseTerminalId, createTerminal, addTabAction])

  const closeTab = useCallback(async (tabIndex: number) => {
    if (tabs.length <= 1) {
      return
    }

    const tabToClose = tabs.find(t => t.index === tabIndex)
    if (!tabToClose) return

    try {
      await closeTerminalBackend(tabToClose.terminalId)
      globalTerminalCreated.delete(tabToClose.terminalId)
      releaseTerminalInstance(tabToClose.terminalId)

      // Use Jotai action to remove the tab
      removeTabAction({ baseTerminalId, tabIndex })
    } catch (error) {
      logger.error(`Failed to close terminal ${tabToClose.terminalId}:`, error)
    }
  }, [tabs, baseTerminalId, removeTabAction])

  const setActiveTab = useCallback((tabIndex: number) => {
    setActiveTabAction({ baseTerminalId, tabIndex })
  }, [baseTerminalId, setActiveTabAction])

  // Create initial terminal when component mounts
  useEffect(() => {
    const initialTab = tabs[0]
    if (!initialTab) return
    const ensureInitial = async () => {
      try {
        await createTerminal(initialTab.terminalId)
      } catch (err) {
        logger.error('[useTerminalTabs] Failed to initialize initial terminal', err)
      }
    }
    void ensureInitial()
  }, [createTerminal, tabs])

  return {
    tabs,
    activeTab,
    canAddTab: tabs.length < maxTabs,
    addTab,
    closeTab,
    setActiveTab
  }
}
