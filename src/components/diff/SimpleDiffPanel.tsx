import { DiffFileList } from './DiffFileList'
import { useSelection } from '../../contexts/SelectionContext'

interface SimpleDiffPanelProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isOrchestrator?: boolean
}

export function SimpleDiffPanel({ onFileSelect, sessionNameOverride, isOrchestrator }: SimpleDiffPanelProps) {
  // selection not needed after removing prompt dock
  useSelection()
  // Test hook data-testid for App.test.tsx
  const testProps = { 'data-testid': 'diff-panel' } as any

  // Prompt dock and related functionality removed

  return (
    <div className="relative h-full flex flex-col overflow-hidden" {...testProps}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DiffFileList onFileSelect={onFileSelect} sessionNameOverride={sessionNameOverride} isOrchestrator={isOrchestrator} />
      </div>
    </div>
  )
}
