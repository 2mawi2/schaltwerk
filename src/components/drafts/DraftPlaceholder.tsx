import { useCallback } from 'react'
import { useSelection } from '../../contexts/SelectionContext'
import { DraftEditor } from './DraftEditor'

export function DraftPlaceholder() {
  const { selection } = useSelection()

  const sessionName = selection.kind === 'session' ? selection.payload : undefined

  const handleRun = useCallback(async () => {
    if (!sessionName) return
    // Open Start new task modal prefilled from draft instead of starting directly
    window.dispatchEvent(new CustomEvent('schaltwerk:start-task-from-draft', { detail: { name: sessionName } }))
  }, [sessionName])

  if (!sessionName) {
    return <div className="h-full flex items-center justify-center text-slate-400">No draft selected</div>
  }

  return <DraftEditor sessionName={sessionName} onStart={handleRun} />
}
