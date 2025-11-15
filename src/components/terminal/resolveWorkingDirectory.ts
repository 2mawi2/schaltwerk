import type { Selection } from '../../hooks/useSelection'
import type { EnrichedSession } from '../../types/session'

export function resolveWorkingDirectory(
  selection: Selection,
  terminalsWorkingDirectory: string,
  sessions: EnrichedSession[],
): string {
  const fallback = terminalsWorkingDirectory ?? ''

  if (selection.kind !== 'session') {
    return fallback
  }

  if (selection.worktreePath && selection.worktreePath.length > 0) {
    return selection.worktreePath
  }

  const sessionId = selection.payload
  if (!sessionId) {
    return fallback
  }

  const match = sessions.find(session => session.info.session_id === sessionId)
  return match?.info.worktree_path ?? fallback
}
