import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { DEFAULT_AGENT } from '../constants/agents'

type FocusArea = 'claude' | 'terminal' | 'diff' | 'sidebar'

interface FocusState {
  sessionFocus: Map<string, FocusArea>
  currentFocus: FocusArea | null
}

interface FocusContextType {
  getFocusForSession: (sessionKey: string) => FocusArea
  setFocusForSession: (sessionKey: string, focus: FocusArea) => void
  currentFocus: FocusArea | null
  setCurrentFocus: (focus: FocusArea | null) => void
}

const FocusContext = createContext<FocusContextType | undefined>(undefined)

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusState, setFocusState] = useState<FocusState>({
    sessionFocus: new Map(),
    currentFocus: null
  })

  const getFocusForSession = useCallback((sessionKey: string): FocusArea => {
    return focusState.sessionFocus.get(sessionKey) ?? (DEFAULT_AGENT as FocusArea)
  }, [focusState.sessionFocus])

  const setFocusForSession = useCallback((sessionKey: string, focus: FocusArea) => {
    setFocusState(prev => ({
      ...prev,
      sessionFocus: new Map(prev.sessionFocus.set(sessionKey, focus)),
      currentFocus: focus
    }))
  }, [])

  const setCurrentFocus = useCallback((focus: FocusArea | null) => {
    setFocusState(prev => ({
      ...prev,
      currentFocus: focus
    }))
  }, [])

  return (
    <FocusContext.Provider value={{
      getFocusForSession,
      setFocusForSession,
      currentFocus: focusState.currentFocus,
      setCurrentFocus
    }}>
      {children}
    </FocusContext.Provider>
  )
}

export function useFocus() {
  const context = useContext(FocusContext)
  if (context === undefined) {
    throw new Error('useFocus must be used within a FocusProvider')
  }
  return context
}
