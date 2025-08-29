import { useCallback } from 'react'
import { useSelection } from '../../contexts/SelectionContext'
import { PlanEditor } from './PlanEditor'

export function PlanPlaceholder() {
  const { selection } = useSelection()

  const sessionName = selection.kind === 'session' ? selection.payload : undefined

  const handleRun = useCallback(async () => {
    if (!sessionName) return
    // Open Start new agent modal prefilled from spec instead of starting directly
    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionName } }))
  }, [sessionName])

  if (!sessionName) {
    return <div className="h-full flex items-center justify-center text-slate-400">No spec selected</div>
  }

  return <PlanEditor sessionName={sessionName} onStart={handleRun} />
}
