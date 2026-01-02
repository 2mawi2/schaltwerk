import { memo } from 'react'
import { VscAdd, VscChevronDown, VscChevronRight } from 'react-icons/vsc'
import clsx from 'clsx'
import { LineInfo } from '../../types/diff'
import { getSelectableLineIdentity } from './lineSelection'

interface DiffLineRowProps {
  line: LineInfo
  index: number | string
  isSelected: boolean
  filePath: string
  onLineMouseDown?: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string; event: React.MouseEvent }) => void
  onLineMouseEnter?: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string }) => void
  onLineMouseLeave?: (payload: { filePath: string }) => void
  onLineMouseUp?: (payload: { event: React.MouseEvent; filePath: string }) => void
  onToggleCollapse?: () => void
  isCollapsed?: boolean
  highlightedContent?: string
  onLineNumberContextMenu?: (payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new' }) => void
  onCodeContextMenu?: (payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new', content: string }) => void
  isKeyboardFocused?: boolean
  isHovered?: boolean
}

function DiffLineRowComponent({
  line,
  isSelected,
  filePath,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseLeave,
  onLineMouseUp,
  onToggleCollapse,
  isCollapsed,
  highlightedContent,
  onLineNumberContextMenu,
  onCodeContextMenu,
  isKeyboardFocused = false,
  isHovered = false,
}: DiffLineRowProps) {
  const showFocusIndicator = isHovered || isKeyboardFocused
  if (line.isCollapsible) {
    return (
      <tr style={{ backgroundColor: 'var(--color-bg-hover)' }} className="group">
        <td className="w-10 text-center select-none">
          <button
            onClick={onToggleCollapse}
            className="p-1"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <VscChevronRight /> : <VscChevronDown />}
          </button>
        </td>
        <td className="w-12 px-2 py-0.5 text-center select-none" style={{ color: 'var(--color-text-tertiary)' }}>...</td>
        <td className="w-12 px-2 py-0.5 text-center select-none" style={{ color: 'var(--color-text-tertiary)' }}>...</td>
        <td colSpan={2} className="px-2 py-1">
          <button
            onClick={onToggleCollapse}
            className="text-xs"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
          >
            {line.collapsedCount} unchanged lines
          </button>
        </td>
      </tr>
    )
  }
  
  const { lineNum, side } = getSelectableLineIdentity(line)

  const handleMouseEnter = () => {
    if (lineNum && onLineMouseEnter) {
      onLineMouseEnter({ lineNum, side, filePath })
    }
  }

  const handleMouseLeave = () => {
    if (onLineMouseLeave) {
      onLineMouseLeave({ filePath })
    }
  }

  const oldLineNumber = line.oldLineNumber
  const newLineNumber = line.newLineNumber ?? line.oldLineNumber
  const contentForCopy = line.content ?? ''

  const handleOldLineContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (oldLineNumber && onLineNumberContextMenu) {
      onLineNumberContextMenu({ event, lineNumber: oldLineNumber, side: 'old' })
    }
  }

  const handleNewLineContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (newLineNumber && onLineNumberContextMenu) {
      onLineNumberContextMenu({ event, lineNumber: newLineNumber, side: 'new' })
    }
  }

  const handleCodeContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (lineNum && onCodeContextMenu) {
      onCodeContextMenu({ event, lineNumber: lineNum, side, content: contentForCopy })
    }
  }

  const handleRowMouseDown = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!lineNum || !onLineMouseDown) {
      return
    }
    if (event.button !== 0 || event.defaultPrevented) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target && target.closest('button, a, input, textarea, select, [data-ignore-row-select="true"]')) {
      return
    }
    onLineMouseDown({ lineNum, side, filePath, event })
  }

  const getRowStyles = () => {
    if (isSelected) {
      return { backgroundColor: 'var(--color-accent-cyan-bg)' }
    }
    if (isKeyboardFocused) {
      return { backgroundColor: 'var(--color-bg-hover)' }
    }
    if (line.type === 'added') {
      return { backgroundColor: 'var(--color-accent-green-bg)' }
    }
    if (line.type === 'removed') {
      return { backgroundColor: 'var(--color-accent-red-bg)' }
    }
    return {}
  }

  return (
    <tr
      className={clsx(
        "group relative",
        showFocusIndicator && "ring-1 ring-accent-blue/50",
        lineNum && onLineMouseDown ? 'cursor-pointer' : 'cursor-default'
      )}
      style={getRowStyles()}
      onMouseEnter={(e) => {
        handleMouseEnter()
        if (!isSelected && !isKeyboardFocused) {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
        }
      }}
      onMouseLeave={(e) => {
        handleMouseLeave()
        if (!isSelected && !isKeyboardFocused) {
          e.currentTarget.style.backgroundColor = getRowStyles().backgroundColor || ''
        }
      }}
      data-line-num={lineNum}
      data-side={side}
      onMouseDown={handleRowMouseDown}
      onMouseUp={(event) => onLineMouseUp?.({ event, filePath })}
    >
      {/* Selection button */}
      <td className="w-7 pr-0.5 text-right select-none">
        {lineNum && onLineMouseDown && (
          <button
            onMouseDown={(e) => onLineMouseDown({ lineNum, side, filePath, event: e })}
            onMouseEnter={() => onLineMouseEnter?.({ lineNum, side, filePath })}
            onMouseUp={(e) => onLineMouseUp?.({ event: e, filePath })}
            className={clsx(
              "p-1 rounded",
              showFocusIndicator || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            style={{
              backgroundColor: 'var(--color-accent-blue)',
              color: 'var(--color-text-inverse)',
            }}
            aria-label={`Select line ${lineNum}`}
            title="Click to select line, drag to select range, or press Enter to comment"
          >
            <VscAdd className="text-sm" />
          </button>
        )}
      </td>
      
      {/* Line numbers - show old number for removed lines, new for added/unchanged */}
      <td
        className="w-12 px-2 py-0.5 text-right select-none text-xs font-mono"
        style={{ color: 'var(--color-text-tertiary)' }}
        onContextMenu={handleOldLineContextMenu}
      >
        {line.type === 'removed' ? line.oldLineNumber : ''}
      </td>
      <td
        className="w-12 px-2 py-0.5 text-right select-none text-xs font-mono"
        style={{ color: 'var(--color-text-tertiary)' }}
        onContextMenu={handleNewLineContextMenu}
      >
        {line.type !== 'removed' ? (line.newLineNumber || line.oldLineNumber) : ''}
      </td>
      
      {/* Change indicator */}
      <td
        className="w-6 text-center select-none font-mono font-bold"
        style={{
          color: line.type === 'added' ? 'var(--color-accent-green)' : line.type === 'removed' ? 'var(--color-accent-red)' : 'var(--color-text-primary)'
        }}
      >
        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
      </td>
      
      {/* Code content */}
      <td
        className="px-2 py-0.5 font-mono text-sm relative align-top"
        onContextMenu={handleCodeContextMenu}
      >
        {line.type === 'added' && (
          <div className="absolute left-0 top-0 w-1 h-full" style={{ backgroundColor: 'var(--color-accent-green)' }} />
        )}
        {line.type === 'removed' && (
          <div className="absolute left-0 top-0 w-1 h-full" style={{ backgroundColor: 'var(--color-accent-red)' }} />
        )}
        {highlightedContent ? (
          <code
            className="hljs block max-w-full whitespace-pre-wrap break-words diff-line-code"
            dangerouslySetInnerHTML={{ __html: highlightedContent }}
          />
        ) : (
          <code className="block max-w-full whitespace-pre-wrap break-words diff-line-code" style={{ color: 'var(--color-text-primary)' }}>
            {contentForCopy}
          </code>
        )}
      </td>
    </tr>
  )
}

function areEqual(prev: DiffLineRowProps, next: DiffLineRowProps) {
  return (
    prev.line === next.line &&
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.isCollapsed === next.isCollapsed &&
    prev.highlightedContent === next.highlightedContent &&
    prev.isKeyboardFocused === next.isKeyboardFocused &&
    prev.isHovered === next.isHovered &&
    prev.onLineMouseDown === next.onLineMouseDown &&
    prev.onLineMouseEnter === next.onLineMouseEnter &&
    prev.onLineMouseLeave === next.onLineMouseLeave &&
    prev.onLineMouseUp === next.onLineMouseUp &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.onLineNumberContextMenu === next.onLineNumberContextMenu &&
    prev.onCodeContextMenu === next.onCodeContextMenu
  )
}

export const DiffLineRow = memo(DiffLineRowComponent, areEqual)
