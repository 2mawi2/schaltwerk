import { UnifiedDiffView } from './UnifiedDiffView'
import type { HistoryDiffContext } from '../../types/diff'

interface UnifiedDiffModalProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
  mode?: 'session' | 'history'
  historyContext?: HistoryDiffContext
}

export function UnifiedDiffModal(props: UnifiedDiffModalProps) {
  return <UnifiedDiffView {...props} viewMode="modal" />
}

export type { HistoryDiffContext }