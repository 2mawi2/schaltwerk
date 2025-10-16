import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import { logger } from '../utils/logger'

type ViewMode = 'edit' | 'preview'

interface SpecEditorState {
  viewModes: Map<string, ViewMode>
  dirtySpecs: Set<string>
}

interface SpecEditorStateContextType {
  getViewMode: (sessionId: string) => ViewMode
  setViewMode: (sessionId: string, mode: ViewMode) => void
  isDirty: (sessionId: string) => boolean
  markDirty: (sessionId: string) => void
  markClean: (sessionId: string) => void
  getAllDirtySpecs: () => string[]
}

const SpecEditorStateContext = createContext<SpecEditorStateContextType | undefined>(undefined)

const STORAGE_KEY = 'spec-editor-view-modes'

function loadViewModesFromStorage(): Map<string, ViewMode> {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Array<[string, ViewMode]>
      return new Map(parsed)
    }
  } catch (error) {
    logger.warn('[SpecEditorStateContext] Failed to load view modes from storage', error)
  }
  return new Map()
}

function saveViewModesToStorage(viewModes: Map<string, ViewMode>): void {
  try {
    const array = Array.from(viewModes.entries())
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(array))
  } catch (error) {
    logger.warn('[SpecEditorStateContext] Failed to save view modes to storage', error)
  }
}

export function SpecEditorStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SpecEditorState>(() => ({
    viewModes: loadViewModesFromStorage(),
    dirtySpecs: new Set()
  }))

  useEffect(() => {
    saveViewModesToStorage(state.viewModes)
  }, [state.viewModes])

  const getViewMode = useCallback((sessionId: string): ViewMode => {
    return state.viewModes.get(sessionId) ?? 'preview'
  }, [state.viewModes])

  const setViewMode = useCallback((sessionId: string, mode: ViewMode) => {
    setState(prev => {
      const newViewModes = new Map(prev.viewModes)
      newViewModes.set(sessionId, mode)
      return {
        ...prev,
        viewModes: newViewModes
      }
    })
  }, [])

  const isDirty = useCallback((sessionId: string): boolean => {
    return state.dirtySpecs.has(sessionId)
  }, [state.dirtySpecs])

  const markDirty = useCallback((sessionId: string) => {
    setState(prev => {
      if (prev.dirtySpecs.has(sessionId)) {
        return prev
      }
      const newDirtySpecs = new Set(prev.dirtySpecs)
      newDirtySpecs.add(sessionId)
      return {
        ...prev,
        dirtySpecs: newDirtySpecs
      }
    })
  }, [])

  const markClean = useCallback((sessionId: string) => {
    setState(prev => {
      if (!prev.dirtySpecs.has(sessionId)) {
        return prev
      }
      const newDirtySpecs = new Set(prev.dirtySpecs)
      newDirtySpecs.delete(sessionId)
      return {
        ...prev,
        dirtySpecs: newDirtySpecs
      }
    })
  }, [])

  const getAllDirtySpecs = useCallback((): string[] => {
    return Array.from(state.dirtySpecs)
  }, [state.dirtySpecs])

  return (
    <SpecEditorStateContext.Provider value={{
      getViewMode,
      setViewMode,
      isDirty,
      markDirty,
      markClean,
      getAllDirtySpecs
    }}>
      {children}
    </SpecEditorStateContext.Provider>
  )
}

export function useSpecEditorState() {
  const context = useContext(SpecEditorStateContext)
  if (context === undefined) {
    throw new Error('useSpecEditorState must be used within a SpecEditorStateProvider')
  }
  return context
}
