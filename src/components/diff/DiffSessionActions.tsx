import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCheck, VscDiscard, VscComment, VscLinkExternal, VscPreview } from 'react-icons/vsc'
import type { EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import { usePrComments } from '../../hooks/usePrComments'
import { useTranslation } from '../../common/i18n'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { buildPreviewKey } from '../../store/atoms/preview'

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
  const { t } = useTranslation()
  const { fetchingComments, fetchAndPasteToTerminal } = usePrComments()
  const projectPath = useAtomValue(projectPathAtom)
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

  const handleOpenPrInPreview = useCallback(() => {
    if (!prUrl || !projectPath || !sessionName) return
    const previewKey = buildPreviewKey(projectPath, 'session', sessionName)
    emitUiEvent(UiEvent.OpenPreviewPanel, { previewKey, url: prUrl })
  }, [prUrl, projectPath, sessionName])

  const headerActions = useMemo(() => {
    if (!isSessionSelection) return null

    return (
      <>
        {prNumber && (
          <>
            <button
              onClick={() => { void handleFetchAndPasteComments() }}
              className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              title={t.diffSessionActions.sendPrComments.replace('{number}', String(prNumber))}
              disabled={fetchingComments}
            >
              <VscComment className="text-lg" />
              {fetchingComments ? t.diffSessionActions.fetching : t.diffSessionActions.prComments.replace('{number}', String(prNumber))}
            </button>
            {prUrl && (
              <button
                onClick={() => { void invoke(TauriCommands.OpenExternalUrl, { url: prUrl }) }}
                className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 rounded-md text-sm font-medium flex items-center gap-2"
                title={t.diffSessionActions.openPrInBrowser.replace('{number}', String(prNumber))}
              >
                <VscLinkExternal className="text-lg" />
              </button>
            )}
            {prUrl && (
              <button
                onClick={handleOpenPrInPreview}
                className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 rounded-md text-sm font-medium flex items-center gap-2"
                title={t.diffSessionActions.openPrInPreview.replace('{number}', String(prNumber))}
              >
                <VscPreview className="text-lg" />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => setConfirmResetOpen(true)}
          className="px-2 py-1 bg-red-600/80 hover:bg-red-600 rounded-md text-sm font-medium flex items-center gap-2"
          title={t.diffSessionActions.discardAllChanges}
          disabled={isResetting}
        >
          <VscDiscard className="text-lg" />
          {t.diffSessionActions.resetSession}
        </button>
        {canMarkReviewed && (
          <button
            onClick={() => { void handleMarkReviewedClick() }}
            className="px-2 py-1 bg-green-600/80 hover:bg-green-600 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            title={t.diffSessionActions.markAsReviewedTitle}
            disabled={isMarkingReviewed}
          >
            <VscCheck className="text-lg" />
            {t.diffSessionActions.markAsReviewed}
          </button>
        )}
      </>
    )
  }, [t, isSessionSelection, isResetting, canMarkReviewed, handleMarkReviewedClick, isMarkingReviewed, prNumber, prUrl, fetchingComments, handleFetchAndPasteComments, handleOpenPrInPreview])

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
