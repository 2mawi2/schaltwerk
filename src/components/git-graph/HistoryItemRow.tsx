import { memo, useMemo, useCallback, useLayoutEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { GoGitBranch, GoTag } from 'react-icons/go'
import type { HistoryItemViewModel, HistoryItem, CommitDetailState } from './types'
import { GitGraphRow, SWIMLANE_WIDTH } from './GitGraphRow'
import { groupReferences } from './refGrouping'
import { theme } from '../../common/theme'
import { getFileIcon } from '../../utils/fileIcons'

interface HistoryItemRowProps {
  viewModel: HistoryItemViewModel
  isSelected: boolean
  onSelect: (commitId: string) => void
  onContextMenu: (event: React.MouseEvent, commit: HistoryItem) => void
  detailState?: CommitDetailState
  onToggleDetails: (viewModel: HistoryItemViewModel) => void
  detailTopPadding: number
  detailBottomPadding: number
  detailItemHeight: number
  detailMessageHeight: number
  onOpenCommitDiff?: (viewModel: HistoryItemViewModel, filePath?: string) => void
}

function getReferenceIcon(iconType: string | undefined) {
  switch (iconType) {
    case 'tag':
      return <GoTag />
    case 'branch':
    default:
      return <GoGitBranch />
  }
}

function renderReferences(references: ReturnType<typeof groupReferences>) {
  if (references.length === 0) {
    return null
  }

  return (
    <div className="flex gap-1 items-center ml-1 flex-shrink-0">
      {references.map((ref, index) => {
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
              <span style={{ paddingRight: '0.15em' }}>{ref.count}</span>
            )}
            {showIcon && (
              <span className="flex items-center justify-center" style={{ padding: '0.08em' }}>
                {getReferenceIcon(ref.icon)}
              </span>
            )}
            {ref.showDescription && (
              <span
                style={{ paddingLeft: showIcon ? '0.15em' : '0' }}
                className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[90px]"
              >
                {ref.name}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

interface GitGraphExtensionProps {
  viewModel: HistoryItemViewModel
  height: number
}

function GitGraphExtension({ viewModel, height }: GitGraphExtensionProps) {
  if (height <= 0) {
    return null
  }

  const laneCount = Math.max(viewModel.inputSwimlanes.length, viewModel.outputSwimlanes.length, 1)
  const width = SWIMLANE_WIDTH * (laneCount + 1)

  return (
    <svg
      data-testid="git-graph-extension"
      width={width}
      height={height}
      style={{ display: 'block' }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="presentation"
    >
      {viewModel.outputSwimlanes.map((lane, index) => {
        const x = SWIMLANE_WIDTH * (index + 1)
        return (
          <path
            key={`${lane.id}-${index}`}
            d={`M ${x} 0 V ${height}`}
            stroke={lane.color}
            strokeWidth={1}
            fill="none"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

export const HistoryItemRow = memo(({ viewModel, isSelected, onSelect, onContextMenu, detailState, onToggleDetails, detailTopPadding, detailBottomPadding, detailItemHeight, detailMessageHeight, onOpenCommitDiff }: HistoryItemRowProps) => {
  const { historyItem, isCurrent } = viewModel

  const groupedRefs = useMemo(() => {
    const references = historyItem.references ?? []
    return groupReferences(references)
  }, [historyItem.references])

  const detailContainerRef = useRef<HTMLDivElement | null>(null)
  const [detailHeight, setDetailHeight] = useState(0)

  const rowBgColor = isSelected
    ? theme.colors.accent.blue.DEFAULT + '40'
    : isCurrent
      ? 'rgb(30 58 138 / 0.4)'
      : 'transparent'

  const headerStyles: CSSProperties & Record<'--hover-bg', string> = {
    backgroundColor: rowBgColor,
    '--hover-bg': isSelected || isCurrent ? rowBgColor : theme.colors.background.secondary,
    cursor: 'pointer'
  }

  const handleRowClick = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) {
      return
    }
    onSelect(historyItem.id)
    onToggleDetails(viewModel)
  }, [historyItem.id, onSelect, onToggleDetails, viewModel])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(historyItem.id)
      onToggleDetails(viewModel)
    }
  }, [historyItem.id, onSelect, onToggleDetails, viewModel])

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    onContextMenu(event, historyItem)
  }, [historyItem, onContextMenu])

  const isExpanded = detailState?.isExpanded ?? false
  const detailFiles = detailState?.files ?? []
  const detailIsLoading = detailState?.isLoading ?? false
  const detailError = detailState?.error ?? null
  const detailHasFiles = detailFiles.length > 0

  useLayoutEffect(() => {
    if (!isExpanded) {
      setDetailHeight(0)
      return
    }

    const element = detailContainerRef.current
    if (!element) {
      setDetailHeight(0)
      return
    }

    const updateHeight = () => {
      setDetailHeight(element.getBoundingClientRect().height)
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          setDetailHeight(entry.contentRect.height)
        }
      })
      observer.observe(element)
      updateHeight()
      return () => observer.disconnect()
    }

    updateHeight()
  }, [isExpanded, detailFiles.length])

  const estimatedContentHeight = detailHasFiles ? detailFiles.length * detailItemHeight : detailMessageHeight
  const effectiveDetailHeight = detailHeight > 0 ? detailHeight : estimatedContentHeight
  const extensionHeight = effectiveDetailHeight + detailTopPadding + detailBottomPadding

  const normalizeChangeType = (changeType: string): string => {
    switch (changeType) {
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case 'M':
      case 'R':
      case 'C':
      default:
        return 'modified'
    }
  }

  const detailContent = (() => {
    if (detailIsLoading) {
      return (
        <div className="flex items-center text-xs text-slate-300" style={{ minHeight: detailMessageHeight }}>
          Loading changes…
        </div>
      )
    }

    if (detailError) {
      return (
        <div className="flex flex-col gap-1 text-xs" style={{ minHeight: detailMessageHeight }}>
          <span className="text-red-400">Failed to load changes</span>
          <span className="text-slate-400 truncate" title={detailError}>
            {detailError}
          </span>
        </div>
      )
    }

    if (!detailHasFiles) {
      return (
        <div className="flex items-center text-xs text-slate-300" style={{ minHeight: detailMessageHeight }}>
          No file changes in this commit
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-1 text-xs text-slate-200">
        {detailFiles.map(file => {
          const segments = file.path.split('/')
          const fileName = segments.pop() ?? file.path
          const parentPath = segments.join('/')
          const normalizedType = normalizeChangeType(file.changeType)

          return (
            <div
              key={`${historyItem.id}-${file.path}`}
              className="flex items-center gap-2 px-1 rounded cursor-pointer transition-colors hover:bg-[color:var(--hover-bg)]"
              style={{
                minHeight: detailItemHeight,
                height: detailItemHeight,
                '--hover-bg': theme.colors.background.secondary,
              } as CSSProperties}
              role="button"
              tabIndex={0}
              aria-label={`Open diff for ${file.path} (${normalizedType})`}
              onClick={event => {
                event.stopPropagation()
                onOpenCommitDiff?.(viewModel, file.path)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onOpenCommitDiff?.(viewModel, file.path)
                }
              }}
            >
              <span className="flex items-center justify-center w-4 h-4 text-slate-300 flex-shrink-0">
                {getFileIcon(normalizedType, file.path)}
              </span>
              <div className="flex items-baseline gap-2 min-w-0 flex-1">
                <span
                  className={`${isCurrent ? 'font-semibold' : 'font-medium'} text-slate-200 text-sm truncate`}
                  title={fileName}
                >
                  {fileName}
                </span>
                {parentPath && (
                  <span className="text-slate-400 text-xs truncate" title={parentPath}>
                    {parentPath}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  })()

  return (
    <div className="flex flex-col transition-colors">
      <div
        className="flex items-center px-2 text-sm h-[22px] leading-[22px] gap-2 w-full hover:bg-[color:var(--hover-bg)] transition-colors"
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        role="button"
        tabIndex={0}
        style={headerStyles}
      >
        <div className="flex-shrink-0 flex items-center h-[22px]">
          <GitGraphRow viewModel={viewModel} />
        </div>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className={`${isCurrent ? 'font-semibold' : 'font-medium'} text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis min-w-0`}
            style={{ flexShrink: 1 }}
            title={historyItem.subject}
          >
            {historyItem.subject}
          </span>
          <span
            className="text-slate-400 text-xs whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
            style={{ flexShrink: 3 }}
          >
            {historyItem.author}
          </span>
        </div>
        {renderReferences(groupedRefs)}
      </div>
      {isExpanded && (
        <div
          className="flex gap-2 px-2 pr-3"
          style={{
            paddingTop: detailTopPadding,
            paddingBottom: detailBottomPadding,
          }}
        >
          <div className="flex-shrink-0" style={{ width: SWIMLANE_WIDTH * (Math.max(viewModel.inputSwimlanes.length, viewModel.outputSwimlanes.length, 1) + 1) }}>
            <GitGraphExtension viewModel={viewModel} height={extensionHeight} />
          </div>
          <div className="flex-1 min-w-0" style={{ paddingLeft: 4 }} ref={detailContainerRef}>
            {detailContent}
          </div>
        </div>
      )}
    </div>
  )
})

HistoryItemRow.displayName = 'HistoryItemRow'
