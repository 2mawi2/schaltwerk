import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from './useSelection'
import { useSessions } from './useSessions'
import { useToast } from '../common/toast/ToastProvider'
import { TauriCommands } from '../common/tauriCommands'
import { getSessionDisplayName } from '../utils/sessionDisplayName'
import { logger } from '../utils/logger'
import { isSpec } from '../utils/sessionFilters'

interface UpdateSessionFromParentResult {
  status:
    | 'success'
    | 'already_up_to_date'
    | 'has_uncommitted_changes'
    | 'has_conflicts'
    | 'pull_failed'
    | 'merge_failed'
    | 'no_session'
  parentBranch: string
  message: string
  conflictingPaths: string[]
}

export function useUpdateSessionFromParent() {
  const { pushToast } = useToast()
  const { selection } = useSelection()
  const { sessions } = useSessions()
  const [isUpdating, setIsUpdating] = useState(false)

  const updateSessionFromParent = useCallback(async () => {
    if (selection.kind !== 'session' || !selection.payload) {
      pushToast({
        tone: 'warning',
        title: 'No active session',
        description: 'Select a running session to update from parent branch.',
      })
      return
    }

    const sessionName = selection.payload
    const session = sessions.find(s => s.info.session_id === sessionName)
    if (!session) {
      pushToast({
        tone: 'warning',
        title: 'Session not found',
        description: 'Could not find the selected session.',
      })
      return
    }

    if (isSpec(session.info)) {
      pushToast({
        tone: 'warning',
        title: 'Cannot update spec',
        description: 'Start the session first before updating from parent.',
      })
      return
    }

    setIsUpdating(true)
    try {
      const result = await invoke<UpdateSessionFromParentResult>(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: sessionName },
      )

      const displayName = getSessionDisplayName(session.info)

      switch (result.status) {
        case 'success':
          pushToast({
            tone: 'success',
            title: 'Session updated',
            description: `${displayName} updated from ${result.parentBranch}`,
          })
          break

        case 'already_up_to_date':
          pushToast({
            tone: 'info',
            title: 'Already up to date',
            description: `${displayName} is already up to date with ${result.parentBranch}`,
          })
          break

        case 'has_uncommitted_changes':
          pushToast({
            tone: 'warning',
            title: 'Uncommitted changes',
            description: 'Commit or stash your changes before updating.',
          })
          break

        case 'has_conflicts':
          pushToast({
            tone: 'warning',
            title: 'Merge conflicts',
            description:
              result.conflictingPaths.length > 0
                ? `Conflicts in: ${result.conflictingPaths.slice(0, 3).join(', ')}${result.conflictingPaths.length > 3 ? '...' : ''}`
                : result.message,
          })
          break

        case 'pull_failed':
          pushToast({
            tone: 'error',
            title: 'Update failed',
            description: result.message,
          })
          break

        case 'merge_failed':
          pushToast({
            tone: 'error',
            title: 'Merge failed',
            description: result.message,
          })
          break

        case 'no_session':
          pushToast({
            tone: 'warning',
            title: 'No active session',
            description: result.message,
          })
          break
      }
    } catch (error) {
      logger.error('Failed to update session from parent', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: message,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [selection, sessions, pushToast])

  return {
    updateSessionFromParent,
    isUpdating,
  }
}
