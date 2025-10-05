import { memo, useMemo, useRef, useState, useLayoutEffect, forwardRef } from 'react'
import { FixedSizeList as VirtualList, ListChildComponentProps } from 'react-window'
import type { HistoryItemViewModel } from './types'
import { HistoryItemRow } from './HistoryItemRow'

interface HistoryListProps {
  items: HistoryItemViewModel[]
}

const ROW_HEIGHT = 22

const Row = memo(({ data, index, style }: ListChildComponentProps<HistoryItemViewModel[]>) => {
  const item = data[index]

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

  const itemData = useMemo(() => items, [items])

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 relative">
      {height > 0 && (
        <VirtualList
          className="history-list"
          height={height}
          itemCount={itemData.length}
          itemSize={ROW_HEIGHT}
          width="100%"
          itemData={itemData}
          outerElementType={OuterElement}
        >
          {Row}
        </VirtualList>
      )}
    </div>
  )
})

HistoryList.displayName = 'HistoryList'

const OuterElement = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Outer(props, ref) {
  return <div ref={ref} {...props} className="history-list" />
})
