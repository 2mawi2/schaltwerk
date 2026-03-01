import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { useToast } from '../common/toast/ToastProvider'
import { useSelection } from './useSelection'
import { useFocus } from '../contexts/FocusContext'
import { useSessions } from './useSessions'
import { useClaudeSession } from './useClaudeSession'
import { stableSessionTerminalId } from '../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../common/terminalTargeting'
import { getPasteSubmissionOptions } from '../common/terminalPaste'
import { logger } from '../utils/logger'
import { useTranslation } from '../common/i18n'
import type { GithubPrFeedback } from '../types/githubIssues'
import { formatPrFeedbackForTerminal } from '../components/modals/githubPrFormatting'

interface UsePrFeedbackResult {
  fetchingFeedback: boolean
  fetchAndPasteFeedback: (prNumber: number) => Promise<void>
}

export function usePrFeedback(): UsePrFeedbackResult {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const { selection, setSelection, terminals } = useSelection()
  const { setCurrentFocus, setFocusForSession } = useFocus()
  const { sessions } = useSessions()
  const { getOrchestratorAgentType } = useClaudeSession()
  const [fetchingFeedback, setFetchingFeedback] = useState(false)

  const determineAgentType = useCallback(async (): Promise<string | undefined> => {
    if (selection.kind === 'session') {
      const session = sessions.find(s => s.info.session_id === selection.payload)
      return session?.info?.original_agent_type as string | undefined
    } else if (selection.kind === 'orchestrator') {
      try {
        return await getOrchestratorAgentType()
      } catch (error) {
        logger.error('Failed to get orchestrator agent type:', error)
      }
    }
    return undefined
  }, [selection, sessions, getOrchestratorAgentType])

  const fetchAndPasteFeedback = useCallback(async (prNumber: number) => {
    setFetchingFeedback(true)
    try {
      const feedback = await invoke<GithubPrFeedback>(TauriCommands.GitHubGetPrFeedback, { prNumber })
      const formatted = formatPrFeedbackForTerminal(feedback, prNumber)
      const agentType = await determineAgentType()
      const { useBracketedPaste, needsDelayedSubmit } = getPasteSubmissionOptions(agentType)

      if (selection.kind === 'orchestrator') {
        const baseTerminalId = terminals.top || 'orchestrator-top'
        const terminalId = getActiveAgentTerminalId('orchestrator') ?? baseTerminalId
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: formatted,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'orchestrator' })
        setCurrentFocus('claude')
      } else if (selection.kind === 'session' && typeof selection.payload === 'string') {
        const baseTerminalId = terminals.top || stableSessionTerminalId(selection.payload, 'top')
        const terminalId = getActiveAgentTerminalId(selection.payload) ?? baseTerminalId
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: formatted,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'session', payload: selection.payload })
        setFocusForSession(selection.payload, 'claude')
        setCurrentFocus('claude')
      } else {
        logger.warn('[usePrFeedback] No valid selection context for paste', selection)
        return
      }

      pushToast({
        tone: 'success',
        title: t.toasts.feedbackSent,
        description: t.toasts.feedbackSentDesc
      })
    } catch (error) {
      logger.error(`Failed to fetch PR feedback for PR #${prNumber}`, error)
      pushToast({ tone: 'error', title: t.toasts.fetchFeedbackFailed, description: String(error) })
    } finally {
      setFetchingFeedback(false)
    }
  }, [t, pushToast, selection, terminals, setSelection, setCurrentFocus, setFocusForSession, determineAgentType])

  return {
    fetchingFeedback,
    fetchAndPasteFeedback
  }
}
