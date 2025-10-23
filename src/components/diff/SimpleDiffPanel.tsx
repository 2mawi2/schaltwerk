import { DiffFileList } from './DiffFileList'

interface SimpleDiffPanelProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isCommander?: boolean
}

export function SimpleDiffPanel({ onFileSelect, sessionNameOverride, isCommander }: SimpleDiffPanelProps) {
  const testProps: { 'data-testid': string } = { 'data-testid': 'diff-panel' }

  // Prompt dock and related functionality removed

  return (
    <div className="relative h-full flex flex-col overflow-hidden" {...testProps}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DiffFileList onFileSelect={onFileSelect} sessionNameOverride={sessionNameOverride} isCommander={isCommander} />
      </div>
    </div>
  )
}
