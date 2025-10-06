import { memo, useRef, useState, useLayoutEffect } from 'react'
import { List as VirtualList, type RowComponentProps } from 'react-window'
import type { HistoryItemViewModel } from './types'
import { HistoryItemRow } from './HistoryItemRow'

interface HistoryListProps {
  items: HistoryItemViewModel[]
}

const ROW_HEIGHT = 22

const Row = memo(({ items, index, style }: RowComponentProps<{ items: HistoryItemViewModel[] }>) => {
  const item = items[index]

  return (
    <div style={style}>
      <HistoryItemRow viewModel={item} />
    </div>
  )
})

Row.displayName = 'HistoryVirtualRow'

export const HistoryList = memo(({ items }: HistoryListProps) => {
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
          rowProps={{ items }}
          rowComponent={Row}
        />
      )}
    </div>
  )
})

HistoryList.displayName = 'HistoryList'
