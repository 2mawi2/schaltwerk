import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

interface FontSizeContextType {
  terminalFontSize: number
  uiFontSize: number
  setTerminalFontSize: (size: number) => void
  setUiFontSize: (size: number) => void
  increaseFontSizes: () => void
  decreaseFontSizes: () => void
  resetFontSizes: () => void
}

const FontSizeContext = createContext<FontSizeContextType | undefined>(undefined)

const DEFAULT_TERMINAL_FONT_SIZE = 13 // Use theme.fontSize.terminal
const DEFAULT_UI_FONT_SIZE = 14 // Use theme.fontSize.body
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const FONT_SIZE_STEP = 1

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE)
  const [uiFontSize, setUiFontSize] = useState(DEFAULT_UI_FONT_SIZE)
  const [initialized, setInitialized] = useState(false)
  const lastSavedRef = useRef<{ terminal: number; ui: number } | null>(null)

  // Load font sizes from database on mount
  useEffect(() => {
    invoke<unknown>(TauriCommands.SchaltwerkCoreGetFontSizes)
      .then((value) => {
        let terminal: number | undefined
        let ui: number | undefined

        if (Array.isArray(value) && value.length >= 2) {
          const [t, u] = value as [number, number]
          terminal = t
          ui = u
        } else if (
          value !== null && typeof value === 'object' &&
          'terminal' in (value as Record<string, unknown>) &&
          'ui' in (value as Record<string, unknown>)
        ) {
          const obj = value as { terminal: number; ui: number }
          terminal = obj.terminal
          ui = obj.ui
        } else {
          throw new Error('Unexpected font size format')
        }

        if (typeof terminal === 'number' && terminal >= MIN_FONT_SIZE && terminal <= MAX_FONT_SIZE) {
          setTerminalFontSize(terminal)
        }
        if (typeof ui === 'number' && ui >= MIN_FONT_SIZE && ui <= MAX_FONT_SIZE) {
          setUiFontSize(ui)
        }
        setInitialized(true)
      })
      .catch(err => {
        logger.error('Failed to load font sizes:', err)
        setInitialized(true)
      })
  }, [])

  // Save font sizes to database when they change (debounced) and update CSS vars/events immediately
  useEffect(() => {
    if (!initialized) return

    document.documentElement.style.setProperty('--terminal-font-size', `${terminalFontSize}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${uiFontSize}px`)

    window.dispatchEvent(new CustomEvent('font-size-changed', {
      detail: { terminalFontSize, uiFontSize }
    }))

    const pending = { terminal: terminalFontSize, ui: uiFontSize }

    // Skip invoke if values match last saved to avoid redundant writes
    if (lastSavedRef.current &&
        lastSavedRef.current.terminal === pending.terminal &&
        lastSavedRef.current.ui === pending.ui) {
      return
    }

    const t = setTimeout(() => {
      // Double-check before saving
      if (lastSavedRef.current &&
          lastSavedRef.current.terminal === pending.terminal &&
          lastSavedRef.current.ui === pending.ui) {
        return
      }
      lastSavedRef.current = pending
      invoke(TauriCommands.SchaltwerkCoreSetFontSizes, {
        terminalFontSize: pending.terminal,
        uiFontSize: pending.ui
      }).catch(err => logger.error('Failed to save font sizes:', err))
    }, 400)

    return () => clearTimeout(t)
  }, [terminalFontSize, uiFontSize, initialized])

  const handleSetTerminalFontSize = (size: number) => {
    if (size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      setTerminalFontSize(size)
    }
  }

  const handleSetUiFontSize = (size: number) => {
    if (size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      setUiFontSize(size)
    }
  }

  const increaseFontSizes = () => {
    setTerminalFontSize(prev => Math.min(prev + FONT_SIZE_STEP, MAX_FONT_SIZE))
    setUiFontSize(prev => Math.min(prev + FONT_SIZE_STEP, MAX_FONT_SIZE))
  }

  const decreaseFontSizes = () => {
    setTerminalFontSize(prev => Math.max(prev - FONT_SIZE_STEP, MIN_FONT_SIZE))
    setUiFontSize(prev => Math.max(prev - FONT_SIZE_STEP, MIN_FONT_SIZE))
  }

  const resetFontSizes = () => {
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE)
    setUiFontSize(DEFAULT_UI_FONT_SIZE)
  }

  return (
    <FontSizeContext.Provider value={{
      terminalFontSize,
      uiFontSize,
      setTerminalFontSize: handleSetTerminalFontSize,
      setUiFontSize: handleSetUiFontSize,
      increaseFontSizes,
      decreaseFontSizes,
      resetFontSizes
    }}>
      {children}
    </FontSizeContext.Provider>
  )
}

export function useFontSize() {
  const context = useContext(FontSizeContext)
  if (context === undefined) {
    throw new Error('useFontSize must be used within a FontSizeProvider')
  }
  return context
}
