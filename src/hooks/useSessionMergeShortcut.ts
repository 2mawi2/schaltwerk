import { useCallback, useState } from 'react'
import { useSessions } from './useSessions'
import { useSelection } from './useSelection'
import { useModal } from '../contexts/ModalContext'
import { useToast } from '../common/toast/ToastProvider'
import { getSessionDisplayName } from '../utils/sessionDisplayName'
import { logger } from '../utils/logger'
import { FilterMode } from '../types/sessionFilters'
import type { EnrichedSession } from '../types/session'

interface UseSessionMergeShortcutOptions {
  enableFilterPivot?: boolean
  getCommitDraftForSession?: (sessionId: string) => string | undefined
}

type HandleMergeShortcut = (sessionIdOverride?: string | null) => Promise<void>

export function useSessionMergeShortcut(options: UseSessionMergeShortcutOptions = {}) {
  const { enableFilterPivot = false, getCommitDraftForSession } = options
  const { selection } = useSelection()
  const {
    sessions,
    allSessions,
    quickMergeSession,
    filterMode,
    setFilterMode,
    mergeDialogState,
    isMergeInFlight,
  } = useSessions()
  const { isAnyModalOpen } = useModal()
  const { pushToast } = useToast()
  const [isMerging, setIsMerging] = useState(false)

  const findSessionById = useCallback((sessionId: string): EnrichedSession | null => {
    return (
      sessions.find(candidate => candidate.info.session_id === sessionId) ??
      allSessions.find(candidate => candidate.info.session_id === sessionId) ??
      null
    )
  }, [sessions, allSessions])

  const isSessionMerging = useCallback((sessionId: string) => {
    return (
      isMergeInFlight(sessionId) ||
      (mergeDialogState.status === 'running' && mergeDialogState.sessionName === sessionId)
    )
  }, [isMergeInFlight, mergeDialogState])

  const handleMergeShortcut: HandleMergeShortcut = useCallback(async (sessionIdOverride) => {
    if (isAnyModalOpen()) {
      return
    }

    const selectedSessionId =
      sessionIdOverride ?? (selection.kind === 'session' ? selection.payload ?? null : null)

    if (!selectedSessionId) {
      return
    }

    const session = findSessionById(selectedSessionId)
    if (!session) {
      return
    }

    if (isSessionMerging(selectedSessionId)) {
      pushToast({
        tone: 'info',
        title: 'Merge already running',
        description: `${getSessionDisplayName(session.info)} is already merging.`,
      })
      return
    }

    const commitDraft = getCommitDraftForSession?.(selectedSessionId) ?? null

    setIsMerging(true)
    try {
      const result = await quickMergeSession(selectedSessionId, { commitMessage: commitDraft })
      const shouldPivotFilter =
        enableFilterPivot && filterMode === FilterMode.Running && Boolean(result.autoMarkedReady)

      if (shouldPivotFilter) {
        setFilterMode(FilterMode.All)
      }

      if (result.status === 'started') {
        pushToast({
          tone: 'info',
          title: `Merging ${getSessionDisplayName(session.info)}`,
          description: `Fast-forwarding ${session.info.base_branch ?? 'main'}...`,
        })
        if (shouldPivotFilter) {
          pushToast({
            tone: 'info',
            title: 'Session moved to review',
            description: 'Switched to the “All” filter so the reviewed session stays visible. Switch back anytime.',
          })
        }
        return
      }

      if (result.status === 'needs-modal') {
        if (result.reason === 'conflict') {
          pushToast({
            tone: 'warning',
            title: 'Conflicts detected',
            description: 'Review conflicts in the merge dialog.',
          })
        } else if (result.reason === 'missing-commit') {
          pushToast({
            tone: 'info',
            title: 'Commit message required',
            description: 'Review and confirm the merge details.',
          })
        } else if (result.reason === 'confirm' && result.autoMarkedReady) {
          pushToast({
            tone: 'info',
            title: 'Session ready to merge',
            description: 'Review the commit message before confirming the merge.',
          })
        }
        return
      }

      if (result.status === 'blocked') {
        switch (result.reason) {
          case 'already-merged':
            pushToast({
              tone: 'info',
              title: 'Nothing to merge',
              description: `${getSessionDisplayName(session.info)} is already up to date.`,
            })
            return
          case 'in-flight':
            pushToast({
              tone: 'info',
              title: 'Merge already running',
              description: `${getSessionDisplayName(session.info)} is merging elsewhere.`,
            })
            return
          case 'no-session':
          case 'not-ready':
            pushToast({
              tone: 'info',
              title: 'Select a reviewed session',
              description: 'Choose a reviewed session before merging.',
            })
            return
          default:
            return
        }
      }

      if (result.status === 'error') {
        pushToast({
          tone: 'error',
          title: 'Merge failed',
          description: result.message,
        })
      }
    } catch (error) {
      logger.error('Quick merge shortcut failed', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Merge failed',
        description: message,
      })
    } finally {
      setIsMerging(false)
    }
  }, [
    enableFilterPivot,
    filterMode,
    findSessionById,
    getCommitDraftForSession,
    isAnyModalOpen,
    isSessionMerging,
    pushToast,
    quickMergeSession,
    selection,
    setFilterMode,
  ])

  return {
    handleMergeShortcut,
    isMerging,
    isSessionMerging,
  }
}
