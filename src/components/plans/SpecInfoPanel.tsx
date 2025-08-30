import { useState, useCallback } from 'react'
import { VscPlay, VscRocket } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'

interface Props {
  sessionName: string
}

export function SpecInfoPanel({ sessionName }: Props) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRun = useCallback(async () => {
    try {
      setStarting(true)
      setError(null)
      console.log('[SpecInfoPanel] Dispatching start-agent-from-spec event for:', sessionName)
      // Open Start new agent modal prefilled from spec instead of starting directly
      window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionName } }))
    } catch (e: any) {
      console.error('[SpecInfoPanel] Failed to open start modal from spec:', e)
      setError(String(e))
    } finally {
      setStarting(false)
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
        <button
          onClick={handleRun}
          disabled={starting}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          title="Run agent (⌘⏎)"
        >
          <VscPlay className="text-xs" />
          {starting ? (
            <AnimatedText text="starting" colorClassName="text-white" size="xs" centered={false} />
          ) : 'Run Agent'}
        </button>
        {error && (
          <div className="mt-3 text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}