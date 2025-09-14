import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import type { HeaderActionConfig } from '../components/ActionButton'
import { useProject } from './ProjectContext'
import { logger } from '../utils/logger'

interface ActionButtonsContextType {
  actionButtons: HeaderActionConfig[]
  loading: boolean
  error: string | null
  saveActionButtons: (buttons: HeaderActionConfig[]) => Promise<boolean>
  resetToDefaults: () => Promise<boolean>
  reloadActionButtons: () => Promise<void>
}

const ActionButtonsContext = createContext<ActionButtonsContextType | undefined>(undefined)

export function ActionButtonsProvider({ children }: { children: ReactNode }) {
  const { projectPath } = useProject()
  const [actionButtons, setActionButtons] = useState<HeaderActionConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadActionButtons = useCallback(async () => {
    if (!projectPath) {
      logger.info('No project path available, skipping action buttons load')
      setActionButtons([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      logger.info('Loading action buttons for project:', projectPath)
      const buttons = await invoke<HeaderActionConfig[]>(TauriCommands.GetProjectActionButtons)
      logger.info('Action buttons loaded:', buttons)
      setActionButtons(buttons)
    } catch (err) {
      logger.error('Failed to load action buttons:', err)
      setError(err instanceof Error ? err.message : 'Failed to load action buttons')
      setActionButtons([])
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  const saveActionButtons = async (buttons: HeaderActionConfig[]) => {
    try {
      logger.info('Saving action buttons payload:', buttons)
      await invoke(TauriCommands.SetProjectActionButtons, { actions: buttons })
      // Round‑trip to backend to ensure canonical state and trigger consumers to update
      await loadActionButtons()
      logger.info('Action buttons saved and reloaded:', buttons)
      return true
    } catch (err) {
      logger.error('Failed to save action buttons:', err)
      setError(err instanceof Error ? err.message : 'Failed to save action buttons')
      return false
    }
  }

  const resetToDefaults = async () => {
    const defaultButtons: HeaderActionConfig[] = [
      {
        id: "merge-reviewed",
        label: "Merge",
        prompt: "Find all reviewed sessions and merge them to the main branch with proper commit messages.",
        color: "green",
      },
      {
        id: "create-pr",
        label: "PR", 
        prompt: "Create a pull request for the current branch with a comprehensive description of changes.",
        color: "blue",
      },
      {
        id: "run-tests",
        label: "Test",
        prompt: "Run all tests and fix any failures that occur.",
        color: "amber",
      },
    ]
    
    return saveActionButtons(defaultButtons)
  }

  useEffect(() => {
    loadActionButtons()
  }, [loadActionButtons])

  return (
    <ActionButtonsContext.Provider value={{
      actionButtons,
      loading,
      error,
      saveActionButtons,
      resetToDefaults,
      reloadActionButtons: loadActionButtons,
    }}>
      {children}
    </ActionButtonsContext.Provider>
  )
}

export function useActionButtons() {
  const context = useContext(ActionButtonsContext)
  if (!context) {
    throw new Error('useActionButtons must be used within ActionButtonsProvider')
  }
  return context
}
