import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSessions } from './useSessions'
import { useSelection } from './useSelection'
import { useModal } from '../contexts/ModalContext'
import { useToast } from '../common/toast/ToastProvider'
import { logger } from '../utils/logger'
import { TauriCommands } from '../common/tauriCommands'
import type { EnrichedSession } from '../types/session'
import type { PrPreviewResponse } from '../components/modals/PrSessionModal'

interface UseSessionPrShortcutOptions {
  onOpenModal: (
    sessionName: string,
    preview: PrPreviewResponse,
    prefill?: {
      suggestedTitle?: string
      suggestedBody?: string
      suggestedBaseBranch?: string
      suggestedPrBranchName?: string
      suggestedMode?: 'squash' | 'reapply'
    }
  ) => void
}

type HandlePrShortcut = (sessionIdOverride?: string | null, prefill?: {
  suggestedTitle?: string
  suggestedBody?: string
  suggestedBaseBranch?: string
  suggestedPrBranchName?: string
  suggestedMode?: 'squash' | 'reapply'
}) => Promise<void>

export function useSessionPrShortcut(options: UseSessionPrShortcutOptions) {
  const { onOpenModal } = options
  const { selection } = useSelection()
  const { sessions, allSessions } = useSessions()
  const { isAnyModalOpen } = useModal()
  const { pushToast } = useToast()
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

  const findSessionById = useCallback((sessionId: string): EnrichedSession | null => {
    return (
      sessions.find(candidate => candidate.info.session_id === sessionId) ??
      allSessions.find(candidate => candidate.info.session_id === sessionId) ??
      null
    )
  }, [sessions, allSessions])

  const handlePrShortcut: HandlePrShortcut = useCallback(async (sessionIdOverride, prefill) => {
    if (isAnyModalOpen()) {
      return
    }

    const selectedSessionId =
      sessionIdOverride ?? (selection.kind === 'session' ? selection.payload ?? null : null)

    if (!selectedSessionId) {
      pushToast({
        tone: 'info',
        title: 'Select a session',
        description: 'Select a running or reviewed session to create a PR.',
      })
      return
    }

    const session = findSessionById(selectedSessionId)
    if (!session) {
      pushToast({
        tone: 'error',
        title: 'Session not found',
        description: 'The selected session could not be found.',
      })
      return
    }

    if (session.info.session_state === 'spec') {
      pushToast({
        tone: 'warning',
        title: 'Cannot create PR for spec',
        description: 'Start the spec session before creating a pull request.',
      })
      return
    }

    setIsLoadingPreview(true)
    try {
      const preview = await invoke<PrPreviewResponse>(TauriCommands.GitHubPreviewPr, {
        sessionName: selectedSessionId,
      })

      onOpenModal(selectedSessionId, preview, prefill)
    } catch (error) {
      logger.error('Failed to load PR preview', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Failed to load PR preview',
        description: message,
      })
    } finally {
      setIsLoadingPreview(false)
    }
  }, [
    findSessionById,
    isAnyModalOpen,
    onOpenModal,
    pushToast,
    selection,
  ])

  return {
    handlePrShortcut,
    isLoadingPreview,
  }
}
