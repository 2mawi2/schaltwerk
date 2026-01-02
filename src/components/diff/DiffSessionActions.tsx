import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCheck, VscDiscard, VscComment, VscLinkExternal } from 'react-icons/vsc'
import type { EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import { usePrComments } from '../../hooks/usePrComments'

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
  const { fetchingComments, fetchAndPasteToTerminal } = usePrComments()
  const [isResetting, setIsResetting] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false)

  const prNumber = targetSession?.info.pr_number
  const prUrl = targetSession?.info.pr_url

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
      await invoke(TauriCommands.SchaltwerkCoreMarkSessionReady, {
        name: sessionName
      })
      await onReloadSessions()
      onClose()
    } catch (error) {
      logger.error('[DiffSessionActions] Failed to mark session as reviewed:', error)
      alert(`Failed to mark session as reviewed: ${error}`)
    } finally {
      setIsMarkingReviewed(false)
    }
  }, [targetSession, sessionName, isMarkingReviewed, onReloadSessions, onClose])

  const handleFetchAndPasteComments = useCallback(async () => {
    if (!prNumber) return
    await fetchAndPasteToTerminal(prNumber)
  }, [prNumber, fetchAndPasteToTerminal])

  const headerActions = useMemo(() => {
    if (!isSessionSelection) return null

    return (
      <>
        {prNumber && (
          <>
            <button
              onClick={() => { void handleFetchAndPasteComments() }}
              className="px-2 py-1 bg-accent-blue/80 hover:bg-accent-blue rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              title={`Send PR #${prNumber} review comments to terminal`}
              disabled={fetchingComments}
            >
              <VscComment className="text-lg" />
              {fetchingComments ? 'Fetching...' : `PR #${prNumber} Comments`}
            </button>
            {prUrl && (
              <button
                onClick={() => { void invoke(TauriCommands.OpenExternalUrl, { url: prUrl }) }}
                className="px-2 py-1 bg-accent-blue/80 hover:bg-accent-blue rounded-md text-sm font-medium flex items-center gap-2"
                title={`Open PR #${prNumber} in browser`}
              >
                <VscLinkExternal className="text-lg" />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => setConfirmResetOpen(true)}
          className="px-2 py-1 bg-accent-red/80 hover:bg-accent-red rounded-md text-sm font-medium flex items-center gap-2"
          title="Discard all changes and reset this session"
          disabled={isResetting}
        >
          <VscDiscard className="text-lg" />
          Reset Session
        </button>
        {canMarkReviewed && (
          <button
            onClick={() => { void handleMarkReviewedClick() }}
            className="px-2 py-1 bg-accent-green/80 hover:bg-accent-green rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Mark this session as reviewed"
            disabled={isMarkingReviewed}
          >
            <VscCheck className="text-lg" />
            Mark as Reviewed
          </button>
        )}
      </>
    )
  }, [isSessionSelection, isResetting, canMarkReviewed, handleMarkReviewedClick, isMarkingReviewed, prNumber, prUrl, fetchingComments, handleFetchAndPasteComments])

  const dialogs = useMemo(() => (
    <ConfirmResetDialog
      open={confirmResetOpen && isSessionSelection}
      onCancel={() => setConfirmResetOpen(false)}
      onConfirm={() => { void handleConfirmReset() }}
      isBusy={isResetting}
    />
  ), [confirmResetOpen, isSessionSelection, handleConfirmReset, isResetting])

  return <>{children({ headerActions, dialogs })}</>
}
