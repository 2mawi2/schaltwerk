import { UnifiedTab, UnifiedTabDragHandlers } from './UnifiedTab'

interface TabProps {
  projectPath: string
  projectName: string
  attentionCount?: number
  isActive: boolean
  onSelect: () => void | Promise<void | boolean>
  onClose: () => void | Promise<void>
  dragHandlers?: UnifiedTabDragHandlers
  isDraggedOver?: boolean
  isDragging?: boolean
}

export function Tab({ projectPath, projectName, attentionCount, isActive, onSelect, onClose, dragHandlers, isDraggedOver, isDragging }: TabProps) {
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
      dragHandlers={dragHandlers}
      isDraggedOver={isDraggedOver}
      isDragging={isDragging}
    />
  )
}
