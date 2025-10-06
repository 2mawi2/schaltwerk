import { memo, useMemo, useCallback } from 'react'
import { GoGitBranch, GoTag } from 'react-icons/go'
import type { HistoryItemViewModel, HistoryItem } from './types'
import { GitGraphRow } from './GitGraphRow'
import { groupReferences } from './refGrouping'
import { theme } from '../../common/theme'

interface HistoryItemRowProps {
  viewModel: HistoryItemViewModel
  isSelected: boolean
  onSelect: (commitId: string) => void
  onContextMenu: (event: React.MouseEvent, commit: HistoryItem) => void
}

export const HistoryItemRow = memo(({ viewModel, isSelected, onSelect, onContextMenu }: HistoryItemRowProps) => {
  const { historyItem, isCurrent } = viewModel

  const groupedRefs = useMemo(() => {
    const references = historyItem.references ?? []
    return groupReferences(references)
  }, [historyItem.references])

  const getIcon = (iconType: string | undefined) => {
    switch (iconType) {
      case 'tag':
        return <GoTag />
      case 'branch':
      default:
        return <GoGitBranch />
    }
  }

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (event.button === 0) {
      onSelect(historyItem.id)
    }
  }, [historyItem.id, onSelect])

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    onContextMenu(event, historyItem)
  }, [historyItem, onContextMenu])

  const rowBgColor = isSelected
    ? theme.colors.accent.blue.DEFAULT + '40'
    : isCurrent
      ? 'rgb(30 58 138 / 0.4)'
      : 'transparent'

  return (
    <div
      className="flex items-center px-2 text-sm h-[22px] leading-[22px] gap-1 w-full cursor-pointer hover:bg-[color:var(--hover-bg)] transition-colors"
      style={{
        backgroundColor: rowBgColor,
        '--hover-bg': isSelected || isCurrent ? rowBgColor : theme.colors.background.secondary
      } as React.CSSProperties}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
        <div className="flex-shrink-0 flex items-center h-[22px]">
          <GitGraphRow viewModel={viewModel} />
        </div>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`${isCurrent ? 'font-semibold' : 'font-medium'} text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis min-w-0`} style={{ flexShrink: 1 }} title={historyItem.subject}>
            {historyItem.subject}
          </span>
          <span className="text-slate-400 text-xs whitespace-nowrap overflow-hidden text-ellipsis min-w-0" style={{ flexShrink: 3 }}>
            {historyItem.author}
          </span>
        </div>
        {groupedRefs.length > 0 && (
          <div className="flex gap-1 items-center ml-1 flex-shrink-0">
            {groupedRefs.map((ref, index) => {
              const hasColor = ref.color !== undefined
              const backgroundColor = hasColor ? ref.color : theme.colors.overlay.light
              const textColor = hasColor ? theme.colors.text.primary : theme.colors.text.secondary
              const showCount = ref.count !== undefined && ref.count > 1
              const showIcon = ref.showIconOnly || (ref.count !== undefined && ref.count >= 1) || ref.icon === 'tag'

              return (
                <span
                  key={`${ref.id}-${index}`}
                  className="inline-flex items-center flex-shrink-0"
                  style={{
                    backgroundColor,
                    color: textColor,
                    borderRadius: '0.5em',
                    fontSize: '0.9em',
                    lineHeight: '1.3em',
                    fontWeight: 600,
                    textShadow: '0 1px 3px rgba(0, 0, 0, 0.5), 0 0 1px rgba(0, 0, 0, 0.3)',
                    paddingLeft: showIcon || !ref.showDescription ? '0.3em' : '0.45em',
                    paddingRight: ref.showDescription || showIcon ? '0.3em' : '0.45em'
                  }}
                  title={ref.name}
                >
                  {showCount && (
                    <span style={{ paddingRight: '0.15em' }}>
                      {ref.count}
                    </span>
                  )}
                  {showIcon && (
                    <span className="flex items-center justify-center" style={{ padding: '0.08em' }}>
                      {getIcon(ref.icon)}
                    </span>
                  )}
                  {ref.showDescription && (
                    <span style={{ paddingLeft: showIcon ? '0.15em' : '0' }} className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[90px]">
                      {ref.name}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
  )
})

HistoryItemRow.displayName = 'HistoryItemRow'
