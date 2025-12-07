import { useEffect } from 'react'
import { useSelection } from '../hooks/useSelection'
import { useFocus } from '../contexts/FocusContext'

export function FocusSync() {
  const { selection } = useSelection()
  const { getFocusForSession, setCurrentFocus, currentFocus } = useFocus()

  useEffect(() => {
    // Determine session key
    let sessionKey = 'unknown'
    if (selection.kind === 'session' && typeof selection.payload === 'string') {
      sessionKey = selection.payload
    } else if (selection.kind === 'orchestrator') {
      sessionKey = 'orchestrator'
    }

    if (sessionKey !== 'unknown') {
      const storedFocus = getFocusForSession(sessionKey)
      
      // Update global focus to match the session's stored focus (or default/inherited focus)
      // This ensures components like RightPanelTabs update their local state correctly
      if (storedFocus !== currentFocus) {
         setCurrentFocus(storedFocus)
      }
    }
  }, [selection, getFocusForSession, setCurrentFocus, currentFocus])

  return null
}
