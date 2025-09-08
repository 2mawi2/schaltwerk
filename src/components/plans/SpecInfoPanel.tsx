import { useState, useCallback } from 'react'
import { VscPlay, VscRocket, VscTrash } from 'react-icons/vsc'
import { invoke } from '@tauri-apps/api/core'
import { IconButton } from '../common/IconButton'
import { logger } from '../../utils/logger'

interface Props {
  sessionName: string
}

export function SpecInfoPanel({ sessionName }: Props) {
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handleDelete = useCallback(async () => {
    try {
      setDeleting(true)
      setError(null)
      await invoke('schaltwerk_core_cancel_session', { name: sessionName })
      // The parent component should handle the refresh
    } catch (e: unknown) {
      logger.error('[SpecInfoPanel] Failed to delete spec:', e)
      setError(String(e))
    } finally {
      setDeleting(false)
    }
  }, [sessionName])

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-[280px]">
        <div className="mx-auto mb-4 h-10 w-10 rounded-lg bg-slate-800/50 border border-slate-700 flex items-center justify-center">
          <VscRocket className="text-slate-300 text-lg" />
        </div>
        <h3 className="text-slate-100 text-sm font-semibold mb-2">Spec Agent</h3>
        <p className="text-slate-400 text-xs mb-4">
          Start the agent to create a worktree and launch the agent. You can edit the content in the main editor.
        </p>
        
        {/* Icon buttons instead of text button */}
        <div className="flex items-center justify-center gap-2">
          <IconButton
            icon={<VscPlay />}
            onClick={handleRun}
            ariaLabel="Run spec"
            tooltip="Run spec"
            variant="success"
            disabled={starting || deleting}
          />
          <IconButton
            icon={<VscTrash />}
            onClick={handleDelete}
            ariaLabel="Delete spec"
            tooltip="Delete spec"
            variant="danger"
            disabled={starting || deleting}
          />
        </div>
        
        {error && (
          <div className="mt-3 text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}