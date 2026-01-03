import { useEffect } from 'react'
import { useSelection } from '../hooks/useSelection'
import { useFocus } from '../contexts/FocusContext'
import { buildSessionScopeId } from '../common/sessionScope'

export function FocusSync() {
  const { selection } = useSelection()
  const { getFocusForSession, setCurrentFocus, currentFocus } = useFocus()

  useEffect(() => {
    const projectPath = selection.projectPath ?? null
    const sessionKey = selection.kind === 'session'
      ? buildSessionScopeId({ kind: 'session', projectPath, sessionId: selection.payload })
      : buildSessionScopeId({ kind: 'orchestrator', projectPath })

    const storedFocus = getFocusForSession(sessionKey)

    // Update global focus to match the session's stored focus (or default/inherited focus)
    // This ensures components like RightPanelTabs update their local state correctly
    if (storedFocus !== currentFocus) {
      setCurrentFocus(storedFocus)
    }
  }, [selection, getFocusForSession, setCurrentFocus, currentFocus])

  return null
}
