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
import { logger } from '../utils/logger'
import {
  type PrReviewComment,
  formatPrReviewCommentsForTerminal,
  formatPrReviewCommentsForClipboard
} from '../components/modals/githubPrFormatting'

export async function fetchPrReviewComments(prNumber: number): Promise<PrReviewComment[]> {
  return invoke<PrReviewComment[]>(TauriCommands.GitHubGetPrReviewComments, { prNumber })
}

interface UsePrCommentsResult {
  fetchingComments: boolean
  fetchAndPasteToTerminal: (prNumber: number) => Promise<void>
  fetchAndCopyToClipboard: (prNumber: number) => Promise<void>
}

export function usePrComments(): UsePrCommentsResult {
  const { pushToast } = useToast()
  const { selection, setSelection, terminals } = useSelection()
  const { setCurrentFocus, setFocusForSession } = useFocus()
  const { sessions } = useSessions()
  const { getOrchestratorAgentType } = useClaudeSession()
  const [fetchingComments, setFetchingComments] = useState(false)

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

  const fetchAndPasteToTerminal = useCallback(async (prNumber: number) => {
    setFetchingComments(true)
    try {
      const comments = await fetchPrReviewComments(prNumber)

      if (comments.length === 0) {
        pushToast({ tone: 'info', title: 'No comments', description: 'This PR has no review comments' })
        return
      }

      const formatted = formatPrReviewCommentsForTerminal(comments, prNumber)
      const agentType = await determineAgentType()

      let useBracketedPaste = true
      let needsDelayedSubmit = false
      if (agentType === 'claude' || agentType === 'droid') {
        useBracketedPaste = false
        needsDelayedSubmit = true
      }

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
        logger.warn('[usePrComments] No valid selection context for paste', selection)
        return
      }

      pushToast({
        tone: 'success',
        title: 'Comments sent',
        description: `${comments.length} comment${comments.length === 1 ? '' : 's'} sent to terminal`
      })
    } catch (error) {
      logger.error(`Failed to fetch PR comments for PR #${prNumber}`, error)
      pushToast({ tone: 'error', title: 'Failed to fetch comments', description: String(error) })
    } finally {
      setFetchingComments(false)
    }
  }, [pushToast, selection, terminals, setSelection, setCurrentFocus, setFocusForSession, determineAgentType])

  const fetchAndCopyToClipboard = useCallback(async (prNumber: number) => {
    setFetchingComments(true)
    try {
      const comments = await fetchPrReviewComments(prNumber)

      if (comments.length === 0) {
        pushToast({ tone: 'info', title: 'No comments', description: 'This PR has no review comments' })
        return
      }

      const formatted = formatPrReviewCommentsForClipboard(comments)
      await navigator.clipboard.writeText(formatted)

      pushToast({
        tone: 'success',
        title: 'Comments copied',
        description: `${comments.length} comment${comments.length === 1 ? '' : 's'} copied to clipboard`
      })
    } catch (error) {
      logger.error(`Failed to fetch PR comments for PR #${prNumber}`, error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'Failed to fetch comments', description: message })
    } finally {
      setFetchingComments(false)
    }
  }, [pushToast])

  return {
    fetchingComments,
    fetchAndPasteToTerminal,
    fetchAndCopyToClipboard
  }
}
