import { useCallback } from 'react'
import { useSelection } from '../../hooks/useSelection'
import { SpecEditor } from './SpecEditor'
import { useTranslation } from '../../common/i18n'

export function SpecPlaceholder() {
  const { t } = useTranslation()
  const { selection } = useSelection()

  const sessionName = selection.kind === 'session' ? selection.payload : undefined

  const handleRun = useCallback(() => {
    if (!sessionName) return
    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionName } }))
  }, [sessionName])

  if (!sessionName) {
    return <div className="h-full flex items-center justify-center text-slate-400">{t.specWorkspacePanel.noSpecSelected}</div>
  }

  return <SpecEditor sessionName={sessionName} onStart={handleRun} />
}
