import { useState, useCallback } from 'react'
import { VscPlay, VscRocket, VscTrash } from 'react-icons/vsc'
import { IconButton } from '../common/IconButton'
import { logger } from '../../utils/logger'
import { useSessions } from '../../hooks/useSessions'
import { theme } from '../../common/theme'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'

interface Props {
  sessionName: string
}

export function SpecInfoPanel({ sessionName }: Props) {
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { sessions } = useSessions()

  const handleRun = useCallback(async () => {
    try {
      setStarting(true)
      setError(null)
      logger.info('[SpecInfoPanel] Dispatching start-agent-from-spec event for:', sessionName)
      // Open Start new agent modal prefilled from spec instead of starting directly
      window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionName } }))
    } catch (e: unknown) {
      logger.error('[SpecInfoPanel] Failed to open start modal from spec:', e)
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }, [sessionName])

  const handleDelete = useCallback(() => {
    try {
      setDeleting(true)
      setError(null)

      const session = sessions.find(s => s.info.session_id === sessionName)
      const sessionDisplayName = session ? getSessionDisplayName(session.info) : sessionName

      emitUiEvent(UiEvent.SessionAction, {
        action: 'delete-spec',
        sessionId: sessionName,
        sessionName,
        sessionDisplayName,
        branch: session?.info.branch,
        hasUncommittedChanges: false,
      })
    } catch (e: unknown) {
      logger.error('[SpecInfoPanel] Failed to delete spec:', e)
      setError(String(e))
    } finally {
      setDeleting(false)
    }
  }, [sessionName, sessions])

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-[280px]">
        <div className="mx-auto mb-4 h-10 w-10 rounded-lg bg-slate-800/50 border border-slate-700 flex items-center justify-center">
          <VscRocket style={{ fontSize: theme.fontSize.heading, color: theme.colors.text.secondary }} />
        </div>
        <h3 style={{ fontSize: theme.fontSize.body, fontWeight: 600, marginBottom: '0.5rem', color: theme.colors.text.primary }}>Spec Agent</h3>
        <p style={{ fontSize: theme.fontSize.caption, marginBottom: '1rem', color: theme.colors.text.muted }}>
          Start the agent to create a worktree and launch the agent. You can edit the content in the main editor.
        </p>

        <div className="flex items-center justify-center gap-2">
          <IconButton
            icon={<VscPlay />}
            onClick={() => { void handleRun() }}
            ariaLabel="Run spec"
            tooltip="Run spec"
            variant="success"
            disabled={starting || deleting}
          />
          <IconButton
            icon={<VscTrash />}
            onClick={() => { void handleDelete() }}
            ariaLabel="Delete spec"
            tooltip="Delete spec"
            variant="danger"
            disabled={starting || deleting}
          />
        </div>

        {error && (
          <div style={{ marginTop: '0.75rem', fontSize: theme.fontSize.caption, color: theme.colors.accent.red.DEFAULT }}>{error}</div>
        )}
      </div>
    </div>
  )
}
