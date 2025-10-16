import { memo, useState } from 'react'
import { VscAdd, VscChevronDown, VscChevronRight } from 'react-icons/vsc'
import clsx from 'clsx'
import { LineInfo } from '../../types/diff'
import { theme } from '../../common/theme'

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
  onCodeContextMenu
}: DiffLineRowProps) {
  const [isHovered, setIsHovered] = useState(false)
  if (line.isCollapsible) {
    return (
      <tr className="hover:bg-slate-900/50 group">
        <td className="w-10 text-center select-none">
          <button
            onClick={onToggleCollapse}
            className="p-1 text-slate-600 hover:text-slate-400"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <VscChevronRight /> : <VscChevronDown />}
          </button>
        </td>
        <td className="w-12 px-2 py-0.5 text-slate-600 text-center select-none">...</td>
        <td className="w-12 px-2 py-0.5 text-slate-600 text-center select-none">...</td>
        <td colSpan={2} className="px-2 py-1">
          <button
            onClick={onToggleCollapse}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {line.collapsedCount} unchanged lines
          </button>
        </td>
      </tr>
    )
  }
  
  const lineNum = line.oldLineNumber || line.newLineNumber
  const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'
  
  const handleMouseEnter = () => {
    setIsHovered(true)
    if (lineNum && onLineMouseEnter) {
      onLineMouseEnter({ lineNum, side, filePath })
    }
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
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

  return (
    <tr
      className={clsx(
        "group relative",
        line.type === 'added' && "bg-green-900/30 hover:bg-green-900/40",
        line.type === 'removed' && "bg-red-900/30 hover:bg-red-900/40",
        line.type === 'unchanged' && "hover:bg-slate-800/50",
        isSelected && "!bg-cyan-400/30 hover:!bg-cyan-400/40",
        isHovered && "ring-1 ring-cyan-300/50",
        lineNum && onLineMouseDown ? 'cursor-pointer' : 'cursor-default'
      )}
      data-line-num={lineNum}
      data-side={side}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleRowMouseDown}
      onMouseUp={(event) => onLineMouseUp?.({ event, filePath })}
    >
      {/* Selection button */}
      <td className="w-10 text-center select-none">
        {lineNum && onLineMouseDown && (
          <button
            onMouseDown={(e) => onLineMouseDown({ lineNum, side, filePath, event: e })}
            onMouseEnter={(e) => {
              onLineMouseEnter?.({ lineNum, side, filePath })
              if (!isSelected) {
                e.currentTarget.style.color = 'rgb(203, 213, 225)'; // slate-300
                e.currentTarget.style.backgroundColor = 'rgb(30, 41, 59)'; // slate-800
              }
            }}
            onMouseUp={(e) => onLineMouseUp?.({ event: e, filePath })}
            className="p-1 rounded opacity-0 group-hover:opacity-100"
            style={isSelected ? {
              color: theme.colors.accent.blue.light,
              backgroundColor: theme.colors.accent.blue.bg,
              opacity: 1,
            } : {
              color: 'rgb(71, 85, 105)', // slate-600
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.color = 'rgb(71, 85, 105)'; // slate-600
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
            aria-label={`Select line ${lineNum}`}
            title="Click to select line, drag to select range"
          >
            <VscAdd className="text-xs" />
          </button>
        )}
      </td>
      
      {/* Line numbers - show old number for removed lines, new for added/unchanged */}
      <td
        className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono"
        onContextMenu={handleOldLineContextMenu}
      >
        {line.type === 'removed' ? line.oldLineNumber : ''}
      </td>
      <td
        className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono"
        onContextMenu={handleNewLineContextMenu}
      >
        {line.type !== 'removed' ? (line.newLineNumber || line.oldLineNumber) : ''}
      </td>
      
      {/* Change indicator */}
      <td className={clsx(
        "w-6 text-center select-none font-mono font-bold",
        line.type === 'added' && "text-green-400",
        line.type === 'removed' && "text-red-400"
      )}>
        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
      </td>
      
      {/* Code content */}
      <td
        className="px-2 py-0.5 font-mono text-sm relative whitespace-pre"
        onContextMenu={handleCodeContextMenu}
      >
        {line.type === 'added' && (
          <div className="absolute left-0 top-0 w-1 h-full bg-green-400" />
        )}
        {line.type === 'removed' && (
          <div className="absolute left-0 top-0 w-1 h-full bg-red-400" />
        )}
        {highlightedContent ? (
          <code
            className="hljs inline-block whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlightedContent }}
          />
        ) : (
          <code className="text-slate-200 inline-block whitespace-pre">{contentForCopy}</code>
        )}
      </td>
    </tr>
  )
}

function areEqual(prev: DiffLineRowProps, next: DiffLineRowProps) {
  // Avoid re-rendering unless relevant props actually change
  return (
    prev.line === next.line &&
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.isCollapsed === next.isCollapsed &&
    prev.highlightedContent === next.highlightedContent &&
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
