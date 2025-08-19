import { useState, useEffect, useCallback } from 'react'
import { useSelection } from '../../contexts/SelectionContext'
import { VscPlay, VscDebugStart, VscRocket } from 'react-icons/vsc'

export function DraftPlaceholder() {
  const { selection } = useSelection()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionName = selection.kind === 'session' ? selection.payload : undefined

  const handleRun = useCallback(async () => {
    if (!sessionName) return
    try {
      setStarting(true)
      setError(null)
      // Open Start new task modal prefilled from draft instead of starting directly
      window.dispatchEvent(new CustomEvent('schaltwerk:start-task-from-draft', { detail: { name: sessionName } }))
    } catch (e: any) {
      console.error('[DraftPlaceholder] Failed to open start modal from draft:', e)
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }, [sessionName])

  useEffect(() => {
    setError(null)
  }, [sessionName])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !starting) {
        e.preventDefault()
        handleRun()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRun, starting])

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="text-center max-w-[560px] w-full px-6 py-8">
        <div className="mx-auto mb-4 h-10 w-10 rounded-lg bg-slate-800/50 border border-slate-700 flex items-center justify-center">
          <VscRocket className="text-slate-300 text-lg" />
        </div>
        <h2 className="text-slate-100 text-base font-semibold mb-1">Draft task</h2>
        <p className="text-slate-400 text-[13px] mb-5">Start the task to create a worktree and launch the agent. You can edit the content on the right before running.</p>
        <button
          onClick={handleRun}
          disabled={starting}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed group"
          title="Run task (⌘⏎)"
        >
          <span className="flex items-center gap-2">
            {starting ? <VscDebugStart className="text-sm" /> : <VscPlay className="text-sm" />}
            {starting ? 'Starting…' : 'Run Task'}
          </span>
          <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘⏎</span>
        </button>
        {error && (
          <div className="mt-3 text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}
