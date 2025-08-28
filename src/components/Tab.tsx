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
    <div style={{ WebkitAppRegion: 'no-drag' } as any}>
      <UnifiedTab
        id={projectPath}
        label={projectName}
        isActive={isActive}
        onSelect={onSelect}
        onClose={onClose}
        title={projectPath}
        className="h-full"
        style={{
          paddingTop: '4px',
          paddingBottom: '4px',
          fontSize: '11px',
          minWidth: '80px',
          maxWidth: '160px'
        }}
      />
    </div>
  )
}