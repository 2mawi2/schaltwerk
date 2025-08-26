import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'

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

const DEFAULT_TERMINAL_FONT_SIZE = 13
const DEFAULT_UI_FONT_SIZE = 12
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const FONT_SIZE_STEP = 1

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE)
  const [uiFontSize, setUiFontSize] = useState(DEFAULT_UI_FONT_SIZE)
  const [initialized, setInitialized] = useState(false)

  // Load font sizes from database on mount
  useEffect(() => {
    invoke<[number, number]>('schaltwerk_core_get_font_sizes')
      .then(([terminal, ui]) => {
        if (terminal >= MIN_FONT_SIZE && terminal <= MAX_FONT_SIZE) {
          setTerminalFontSize(terminal)
        }
        if (ui >= MIN_FONT_SIZE && ui <= MAX_FONT_SIZE) {
          setUiFontSize(ui)
        }
        setInitialized(true)
      })
      .catch(err => {
        console.error('Failed to load font sizes:', err)
        setInitialized(true)
      })
  }, [])

  // Save font sizes to database when they change
  useEffect(() => {
    if (!initialized) return
    
    invoke('schaltwerk_core_set_font_sizes', { 
      terminalFontSize, 
      uiFontSize 
    })
      .catch(err => console.error('Failed to save font sizes:', err))
    
    document.documentElement.style.setProperty('--terminal-font-size', `${terminalFontSize}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${uiFontSize}px`)
    
    window.dispatchEvent(new CustomEvent('font-size-changed', { 
      detail: { terminalFontSize, uiFontSize } 
    }))
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