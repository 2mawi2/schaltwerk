export interface SessionInfoLike {
  session_id: string
}

export interface EnrichedSessionLike {
  info: SessionInfoLike
}

function isLastInList<T>(index: number, list: T[]): boolean {
  return index === list.length - 1
}

function findSessionIndex(sessions: EnrichedSessionLike[], sessionId: string): number {
  return sessions.findIndex(s => s.info.session_id === sessionId)
}

export function findPreviousSessionIndex(
  previousSessions: EnrichedSessionLike[], 
  sessionId: string
): number {
  return findSessionIndex(previousSessions, sessionId)
}

// Given an ordered list of sessions, the id being removed, and the current selected id,
// return the next session id to select. If the removed one is not the current selection
// or if no sessions remain, return null.
export function computeNextSelectedSessionId(
  sortedSessions: EnrichedSessionLike[],
  removedSessionId: string,
  currentSelectedSessionId: string | null
): string | null {
  const wasSelected = currentSelectedSessionId === removedSessionId
  if (!wasSelected) return null

  const currentIndex = findSessionIndex(sortedSessions, removedSessionId)
  if (currentIndex === -1) return null

  const remaining = sortedSessions.filter(
    s => s.info.session_id !== removedSessionId
  )
  if (remaining.length === 0) return null

  const nextIndex = isLastInList(currentIndex, sortedSessions)
    ? remaining.length - 1
    : currentIndex
  
  return remaining[nextIndex].info.session_id
}
