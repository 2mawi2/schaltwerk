import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCheck, VscDiscard } from 'react-icons/vsc'
import type { EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { ConfirmDiscardDialog } from '../common/ConfirmDiscardDialog'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { logger } from '../../utils/logger'

type DiffSessionActionsRenderProps = {
  headerActions: ReactNode
  fileAction: ReactNode
  dialogs: ReactNode
}

interface DiffSessionActionsProps {
  isSessionSelection: boolean
  isCommanderView: boolean
  sessionName: string | null
  targetSession: EnrichedSession | null
  selectedFile: string | null
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
  isCommanderView,
  sessionName,
  targetSession,
  selectedFile,
  canMarkReviewed,
  onClose,
  onReloadSessions,
  onLoadChangedFiles,
  children
}: DiffSessionActionsProps) {
  const [isResetting, setIsResetting] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
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
      window.dispatchEvent(new CustomEvent('schaltwerk:reset-terminals'))
      onClose()
    } catch (error) {
      logger.error('Failed to reset session worktree:', error)
    } finally {
      setIsResetting(false)
      setConfirmResetOpen(false)
    }
  }, [sessionName, onLoadChangedFiles, onClose])

  const discardCurrentFile = useCallback(async () => {
    if (!selectedFile) return
    try {
      setIsDiscarding(true)

      if (isCommanderView && !sessionName) {
        await invoke(TauriCommands.SchaltwerkCoreDiscardFileInOrchestrator, { filePath: selectedFile })
      } else if (sessionName) {
        await invoke(TauriCommands.SchaltwerkCoreDiscardFileInSession, { sessionName, filePath: selectedFile })
      }

      await onLoadChangedFiles()
    } catch (error) {
      logger.error('Failed to discard file:', error)
    } finally {
      setIsDiscarding(false)
    }
  }, [selectedFile, isCommanderView, sessionName, onLoadChangedFiles])

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

  const fileAction = useMemo(() => {
    if (!selectedFile) return null

    return (
      <div className="absolute right-3 top-2 z-20">
        <button
          onClick={() => setDiscardOpen(true)}
          className="px-2 py-1 rounded bg-slate-800/70 hover:bg-slate-800 text-slate-200 text-xs flex items-center gap-1"
          title="Discard changes for this file"
          disabled={isDiscarding}
        >
          {isDiscarding ? (
            <span className="opacity-80">Discarding…</span>
          ) : (
            <>
              <VscDiscard />
              <span>Discard File</span>
            </>
          )}
        </button>
      </div>
    )
  }, [selectedFile, isDiscarding])

  const dialogs = useMemo(() => (
    <>
      <ConfirmDiscardDialog
        open={discardOpen}
        isBusy={isDiscarding}
        filePath={selectedFile}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={async () => {
          setDiscardOpen(false)
          await discardCurrentFile()
        }}
      />

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
    discardOpen,
    isDiscarding,
    selectedFile,
    discardCurrentFile,
    markReadyModal,
    onReloadSessions,
    onClose,
    confirmResetOpen,
    isSessionSelection,
    handleConfirmReset,
    isResetting
  ])

  return <>{children({ headerActions, fileAction, dialogs })}</>
}
