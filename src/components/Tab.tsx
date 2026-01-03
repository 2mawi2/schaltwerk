import { UnifiedTab } from './UnifiedTab'

interface TabProps {
  projectPath: string
  projectName: string
  attentionCount?: number
  isActive: boolean
  onSelect: () => void | Promise<void | boolean>
  onClose: () => void | Promise<void>
}

export function Tab({ projectPath, projectName, attentionCount, isActive, onSelect, onClose }: TabProps) {
  const badgeLabel =
    attentionCount && attentionCount > 0
      ? (attentionCount > 9 ? '9+' : String(attentionCount))
      : undefined

  return (
    <UnifiedTab
      id={projectPath}
      label={projectName}
      isActive={isActive}
      onSelect={() => { void onSelect() }}
      onClose={() => { void onClose() }}
      title={projectPath}
      className="h-full"
      style={{
        maxWidth: '150px',
        minWidth: '100px'
      }}
      badgeContent={badgeLabel}
    />
  )
}
