import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import {
  KeyboardShortcutAction,
  KeyboardShortcutConfig,
  PartialKeyboardShortcutConfig,
  defaultShortcutConfig,
  mergeShortcutConfig,
  normalizeShortcutConfig,
} from '../keyboardShortcuts/config'
import { logger } from '../utils/logger'

interface KeyboardShortcutContextValue {
  config: KeyboardShortcutConfig
  loading: boolean
  setConfig: (config: KeyboardShortcutConfig) => void
  applyOverrides: (overrides: PartialKeyboardShortcutConfig) => void
  resetToDefaults: () => void
  refresh: () => Promise<void>
}

export const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null)

export const KeyboardShortcutsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<KeyboardShortcutConfig>(defaultShortcutConfig)
  const [loading, setLoading] = useState(false)

  const loadShortcuts = useCallback(async () => {
    setLoading(true)
    try {
      const stored = await invoke<PartialKeyboardShortcutConfig | null>(TauriCommands.GetKeyboardShortcuts)
      setConfig(mergeShortcutConfig(stored ?? undefined))
    } catch (error) {
      logger.error('Failed to load keyboard shortcuts, falling back to defaults', error)
      setConfig(defaultShortcutConfig)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadShortcuts()
  }, [loadShortcuts])

  const handleSetConfig = useCallback((next: KeyboardShortcutConfig) => {
    setConfig(normalizeShortcutConfig(next))
  }, [])

  const applyOverrides = useCallback((overrides: PartialKeyboardShortcutConfig) => {
    setConfig(prev => {
      const normalized = mergeShortcutConfig({ ...prev, ...overrides })
      return normalized
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    setConfig(defaultShortcutConfig)
  }, [])

  const value = useMemo<KeyboardShortcutContextValue>(() => ({
    config,
    loading,
    setConfig: handleSetConfig,
    applyOverrides,
    resetToDefaults,
    refresh: loadShortcuts,
  }), [config, loading, handleSetConfig, applyOverrides, resetToDefaults, loadShortcuts])

  return (
    <KeyboardShortcutContext.Provider value={value}>
      {children}
    </KeyboardShortcutContext.Provider>
  )
}

export const useKeyboardShortcutsConfig = (): KeyboardShortcutContextValue => {
  const ctx = useContext(KeyboardShortcutContext)
  if (!ctx) {
    return {
      config: defaultShortcutConfig,
      loading: false,
      setConfig: () => {},
      applyOverrides: () => {},
      resetToDefaults: () => {},
      refresh: async () => {},
    }
  }
  return ctx
}

export const listKeyboardShortcutActions = (): KeyboardShortcutAction[] => {
  return Object.values(KeyboardShortcutAction)
}
