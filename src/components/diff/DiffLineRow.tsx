import { memo, useState } from 'react'
import { VscAdd, VscChevronDown, VscChevronRight, VscComment } from 'react-icons/vsc'
import clsx from 'clsx'
import { LineInfo } from '../../types/diff'

interface DiffLineRowProps {
  line: LineInfo
  index: number | string
  isSelected: boolean
  onLineMouseDown?: (_lineNum: number, _side: 'old' | 'new', _event: React.MouseEvent) => void
  onLineMouseEnter?: (_lineNum: number, _side: 'old' | 'new') => void
  onLineMouseLeave?: () => void
  onLineMouseUp?: (_event: React.MouseEvent) => void
  onToggleCollapse?: () => void
  isCollapsed?: boolean
  highlightedContent?: string
  hasComment?: boolean
  commentText?: string
  filePath?: string
}

function DiffLineRowComponent({
  line,
  isSelected,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseLeave,
  onLineMouseUp,
  onToggleCollapse,
  isCollapsed,
  highlightedContent,
  hasComment,
  commentText
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
      onLineMouseEnter(lineNum, side)
    }
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    if (onLineMouseLeave) {
      onLineMouseLeave()
    }
  }

  return (
    <tr
      className={clsx(
        "group relative",
        line.type === 'added' && "bg-green-900/30 hover:bg-green-900/40",
        line.type === 'removed' && "bg-red-900/30 hover:bg-red-900/40", 
        line.type === 'unchanged' && "hover:bg-slate-800/50",
        isSelected && "!bg-blue-500/30 hover:!bg-blue-500/40",
        isHovered && "ring-1 ring-blue-400/50"
      )}
      data-line-num={lineNum}
      data-side={side}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Selection button */}
      <td className="w-10 text-center select-none">
        {lineNum && onLineMouseDown && (
          <button
            onMouseDown={(e) => onLineMouseDown(lineNum, side, e)}
            onMouseEnter={() => onLineMouseEnter?.(lineNum, side)}
            onMouseUp={(e) => onLineMouseUp?.(e)}
            className={clsx(
              "p-1 rounded",
              isSelected 
                ? "text-blue-400 bg-blue-500/20 hover:bg-blue-500/30" 
                : "text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-300 hover:bg-slate-800"
            )}
            aria-label={`Select line ${lineNum}`}
            title="Click to select line, drag to select range"
          >
            <VscAdd className="text-xs" />
          </button>
        )}
      </td>
      
      {/* Line numbers - show old number for removed lines, new for added/unchanged */}
      <td className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono">
        {line.type === 'removed' ? line.oldLineNumber : ''}
      </td>
      <td className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono">
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
      <td className="px-2 py-0.5 font-mono text-sm relative whitespace-pre">
        {line.type === 'added' && (
          <div className="absolute left-0 top-0 w-1 h-full bg-green-400" />
        )}
        {line.type === 'removed' && (
          <div className="absolute left-0 top-0 w-1 h-full bg-red-400" />
        )}
        <div className="flex items-start gap-2">
          {highlightedContent ? (
            <code
              className="hljs inline-block whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlightedContent }}
            />
          ) : (
            <code className="text-slate-200 inline-block whitespace-pre">{line.content}</code>
          )}
          <div className="flex items-center gap-2">
            {hasComment && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 rounded text-xs text-blue-400" title={commentText}>
                <VscComment />
                <span>Comment</span>
              </div>
            )}
            {isHovered && lineNum && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-700/70 rounded text-xs text-slate-300 opacity-75">
                <VscComment />
                <span>Press Enter to comment</span>
              </div>
            )}
          </div>
        </div>
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
    prev.hasComment === next.hasComment &&
    prev.commentText === next.commentText &&
    prev.highlightedContent === next.highlightedContent &&
    prev.filePath === next.filePath &&
    prev.onLineMouseDown === next.onLineMouseDown &&
    prev.onLineMouseEnter === next.onLineMouseEnter &&
    prev.onLineMouseLeave === next.onLineMouseLeave &&
    prev.onLineMouseUp === next.onLineMouseUp &&
    prev.onToggleCollapse === next.onToggleCollapse
  )
}

export const DiffLineRow = memo(DiffLineRowComponent, areEqual)
