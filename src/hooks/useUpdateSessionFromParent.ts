import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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

type SessionUpdateOutcome = 'updated' | 'up_to_date' | 'failed'

export function useUpdateSessionFromParent() {
  const { pushToast } = useToast()
  const { sessions } = useSessions()
  const [isUpdating, setIsUpdating] = useState(false)

  const updateSessionFromParent = useCallback(async (sessionName: string) => {
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
  }, [sessions, pushToast])

  const updateAllSessionsFromParent = useCallback(async () => {
    const runningSessions = sessions.filter(s => !isSpec(s.info))

    if (runningSessions.length === 0) {
      pushToast({
        tone: 'warning',
        title: 'No running sessions',
        description: 'There are no running sessions to update.',
      })
      return
    }

    setIsUpdating(true)
    try {
      const results = await Promise.allSettled(
        runningSessions.map(async (session): Promise<SessionUpdateOutcome> => {
          const result = await invoke<UpdateSessionFromParentResult>(
            TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
            { name: session.info.session_id },
          )
          if (result.status === 'success') return 'updated'
          if (result.status === 'already_up_to_date') return 'up_to_date'
          return 'failed'
        }),
      )

      let updated = 0
      let upToDate = 0
      let failed = 0
      const failedNames: string[] = []

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          switch (result.value) {
            case 'updated': updated++; break
            case 'up_to_date': upToDate++; break
            case 'failed':
              failed++
              failedNames.push(getSessionDisplayName(runningSessions[index].info))
              break
          }
        } else {
          failed++
          failedNames.push(getSessionDisplayName(runningSessions[index].info))
        }
      })

      if (failed === 0 && updated > 0) {
        pushToast({
          tone: 'success',
          title: 'All sessions updated',
          description: `${updated} session${updated > 1 ? 's' : ''} updated from parent${upToDate > 0 ? `, ${upToDate} already up to date` : ''}`,
        })
      } else if (failed === 0 && upToDate > 0) {
        pushToast({
          tone: 'info',
          title: 'All sessions up to date',
          description: `${upToDate} session${upToDate > 1 ? 's are' : ' is'} already up to date`,
        })
      } else if (failed > 0 && failed < runningSessions.length) {
        pushToast({
          tone: 'warning',
          title: 'Some sessions had issues',
          description: `${failed} failed: ${failedNames.join(', ')}`,
        })
      } else {
        pushToast({
          tone: 'error',
          title: 'Update failed',
          description: `All ${failed} session${failed > 1 ? 's' : ''} failed to update`,
        })
      }
    } catch (error) {
      logger.error('Failed to update sessions from parent', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: message,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [sessions, pushToast])

  return {
    updateSessionFromParent,
    updateAllSessionsFromParent,
    isUpdating,
  }
}
