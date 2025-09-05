import { UnifiedTab } from './UnifiedTab'

interface TabProps {
  projectPath: string
  projectName: string
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

export function Tab({ projectPath, projectName, isActive, onSelect, onClose }: TabProps) {
  return (
    <UnifiedTab
      id={projectPath}
      label={projectName}
      isActive={isActive}
      onSelect={onSelect}
      onClose={onClose}
      title={projectPath}
      className="h-full"
      style={{
        maxWidth: '150px',
        minWidth: '100px'
      }}
    />
  )
}