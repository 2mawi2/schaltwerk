import { memo, useRef, useState, useLayoutEffect } from 'react'
import { List as VirtualList, type RowComponentProps } from 'react-window'
import type { HistoryItemViewModel, HistoryItem } from './types'
import { HistoryItemRow } from './HistoryItemRow'

interface HistoryListProps {
  items: HistoryItemViewModel[]
  selectedCommitId: string | null
  onSelectCommit: (commitId: string) => void
  onContextMenu: (event: React.MouseEvent, commit: HistoryItem) => void
}

interface RowData {
  items: HistoryItemViewModel[]
  selectedCommitId: string | null
  onSelectCommit: (commitId: string) => void
  onContextMenu: (event: React.MouseEvent, commit: HistoryItem) => void
}

const ROW_HEIGHT = 22

const Row = memo(({ items, selectedCommitId, onSelectCommit, onContextMenu, index, style }: RowComponentProps<RowData>) => {
  const item = items[index]

  return (
    <div style={style}>
      <HistoryItemRow viewModel={item} isSelected={item.historyItem.id === selectedCommitId} onSelect={onSelectCommit} onContextMenu={onContextMenu} />
    </div>
  )
})

Row.displayName = 'HistoryVirtualRow'

export const HistoryList = memo(({ items, selectedCommitId, onSelectCommit, onContextMenu }: HistoryListProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const boxHeight = entry.contentRect.height
        setHeight(boxHeight)
      }
    })

    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 relative">
      {height > 0 && (
        <VirtualList
          className="history-list"
          defaultHeight={height}
          rowCount={items.length}
          rowHeight={ROW_HEIGHT}
          rowProps={{ items, selectedCommitId, onSelectCommit, onContextMenu }}
          rowComponent={Row}
        />
      )}
    </div>
  )
})

HistoryList.displayName = 'HistoryList'
