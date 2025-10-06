import { memo, useRef, useState, useLayoutEffect } from 'react'
import { FixedSizeList as VirtualList } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import type { HistoryItemViewModel } from './types'
import { HistoryItemRow } from './HistoryItemRow'

interface HistoryListProps {
  items: HistoryItemViewModel[]
}

const ROW_HEIGHT = 22

const Row = memo(({ data, index, style }: ListChildComponentProps<HistoryItemViewModel[]>) => {
  const items = data
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
          height={height}
          itemCount={items.length}
          itemSize={ROW_HEIGHT}
          itemData={items}
          width="100%"
        >
          {Row}
        </VirtualList>
      )}
    </div>
  )
})

HistoryList.displayName = 'HistoryList'
