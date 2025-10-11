import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCheck, VscDiscard } from 'react-icons/vsc'
import type { EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'

type DiffSessionActionsRenderProps = {
  headerActions: ReactNode
  dialogs: ReactNode
}

interface DiffSessionActionsProps {
  isSessionSelection: boolean
  sessionName: string | null
  targetSession: EnrichedSession | null
  canMarkReviewed: boolean
  onClose: () => void
  onReloadSessions: () => Promise<void>
  onLoadChangedFiles: () => Promise<void>
  children: (parts: DiffSessionActionsRenderProps) => ReactNode
}

interface MarkReadyModalState {
  open: boolean
  sessionName: string
  hasUncommitted: boolean
}

const initialMarkReadyState: MarkReadyModalState = {
  open: false,
  sessionName: '',
  hasUncommitted: false
}

export function DiffSessionActions({
  isSessionSelection,
  sessionName,
  targetSession,
  canMarkReviewed,
  onClose,
  onReloadSessions,
  onLoadChangedFiles,
  children
}: DiffSessionActionsProps) {
  const [isResetting, setIsResetting] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false)
  const [markReadyModal, setMarkReadyModal] = useState<MarkReadyModalState>(initialMarkReadyState)

  const openMarkReadyModal = useCallback(() => {
    if (!sessionName || !targetSession) return
    setMarkReadyModal({
      open: true,
      sessionName,
      hasUncommitted: targetSession.info.has_uncommitted_changes ?? false
    })
  }, [sessionName, targetSession])

  const handleConfirmReset = useCallback(async () => {
    if (!sessionName) return
    try {
      setIsResetting(true)
      await invoke(TauriCommands.SchaltwerkCoreResetSessionWorktree, { sessionName })
      await onLoadChangedFiles()
      emitUiEvent(UiEvent.TerminalReset, { kind: 'session', sessionId: sessionName })
      onClose()
    } catch (error) {
      logger.error('Failed to reset session worktree:', error)
    } finally {
      setIsResetting(false)
      setConfirmResetOpen(false)
    }
  }, [sessionName, onLoadChangedFiles, onClose])

  const handleMarkReviewedClick = useCallback(async () => {
    if (!targetSession || !sessionName || isMarkingReviewed) return

    setIsMarkingReviewed(true)
    try {
      const autoCommit = await invoke<boolean>(TauriCommands.GetAutoCommitOnReview)
      if (autoCommit) {
        try {
          const success = await invoke<boolean>(TauriCommands.SchaltwerkCoreMarkSessionReady, {
            name: sessionName,
            autoCommit: true
          })

          if (success) {
            await onReloadSessions()
            onClose()
          } else {
            alert('Failed to mark session as reviewed automatically.')
          }
        } catch (error) {
          logger.error('[DiffSessionActions] Failed to auto-mark session as reviewed:', error)
          alert(`Failed to mark session as reviewed: ${error}`)
        }
        return
      }

      openMarkReadyModal()
    } catch (error) {
      logger.error('[DiffSessionActions] Failed to load auto-commit setting for mark reviewed:', error)
      openMarkReadyModal()
    } finally {
      setIsMarkingReviewed(false)
    }
  }, [targetSession, sessionName, isMarkingReviewed, onReloadSessions, onClose, openMarkReadyModal])

  const headerActions = useMemo(() => {
    if (!isSessionSelection) return null

    return (
      <>
        <button
          onClick={() => setConfirmResetOpen(true)}
          className="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded-md text-sm font-medium flex items-center gap-2"
          title="Discard all changes and reset this session"
          disabled={isResetting}
        >
          <VscDiscard className="text-lg" />
          Reset Session
        </button>
        {canMarkReviewed && (
          <button
            onClick={handleMarkReviewedClick}
            className="px-2 py-1 bg-green-600/80 hover:bg-green-600 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Mark this session as reviewed"
            disabled={isMarkingReviewed}
          >
            <VscCheck className="text-lg" />
            Mark as Reviewed
          </button>
        )}
      </>
    )
  }, [isSessionSelection, isResetting, canMarkReviewed, handleMarkReviewedClick, isMarkingReviewed])

  const dialogs = useMemo(() => (
    <>
      <MarkReadyConfirmation
        open={markReadyModal.open}
        sessionName={markReadyModal.sessionName}
        hasUncommittedChanges={markReadyModal.hasUncommitted}
        onClose={() => setMarkReadyModal(initialMarkReadyState)}
        onSuccess={async () => {
          await onReloadSessions()
          onClose()
        }}
      />

      <ConfirmResetDialog
        open={confirmResetOpen && isSessionSelection}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={handleConfirmReset}
        isBusy={isResetting}
      />
    </>
  ), [
    markReadyModal,
    onReloadSessions,
    onClose,
    confirmResetOpen,
    isSessionSelection,
    handleConfirmReset,
    isResetting
  ])

  return <>{children({ headerActions, dialogs })}</>
}
