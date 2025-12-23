import { memo } from 'react'
import clsx from 'clsx'
import { VscAdd } from 'react-icons/vsc'
import type { LineInfo } from '../../types/diff'
import { theme } from '../../common/theme'

interface SplitDiffLineRowProps {
  left: LineInfo
  right: LineInfo
  index: number | string
  filePath: string
  isOldSelected: boolean
  isNewSelected: boolean
  onLineMouseDown?: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string; event: React.MouseEvent }) => void
  onLineMouseEnter?: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string }) => void
  onLineMouseLeave?: (payload: { filePath: string }) => void
  onLineMouseUp?: (payload: { event: React.MouseEvent; filePath: string }) => void
  highlightedLeft?: string
  highlightedRight?: string
  onLineNumberContextMenu?: (payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new' }) => void
  onCodeContextMenu?: (payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new', content: string }) => void
  isPrimaryKeyboardFocused?: boolean
  isPrimaryHovered?: boolean
}

function SplitDiffLineRowComponent({
  left,
  right,
  filePath,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseLeave,
  onLineMouseUp,
  highlightedLeft,
  highlightedRight,
  onLineNumberContextMenu,
  onCodeContextMenu,
  isOldSelected,
  isNewSelected,
  isPrimaryKeyboardFocused = false,
  isPrimaryHovered = false,
}: SplitDiffLineRowProps) {
  const oldLineNumber = left.oldLineNumber
  const newLineNumber = right.newLineNumber

  const primary =
    (newLineNumber && { lineNum: newLineNumber, side: 'new' as const }) ||
    (oldLineNumber && { lineNum: oldLineNumber, side: 'old' as const }) ||
    null

  const showFocusIndicator = isPrimaryHovered || isPrimaryKeyboardFocused

  const leftContent = left.content ?? ''
  const rightContent = right.content ?? ''

  const resolveLineTarget = (node: EventTarget | null) => {
    const element = node as HTMLElement | null
    const sideNode = element?.closest('[data-split-side]') as HTMLElement | null
    const side = (sideNode?.dataset.splitSide as 'old' | 'new' | undefined) ?? null

    if (side === 'old' && oldLineNumber !== undefined) {
      return { lineNum: oldLineNumber, side: 'old' as const }
    }
    if (side === 'new' && newLineNumber !== undefined) {
      return { lineNum: newLineNumber, side: 'new' as const }
    }

    return primary
  }

  const triggerMouseLeave = () => {
    onLineMouseLeave?.({ filePath })
  }

  const handleRowMouseDown = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!onLineMouseDown) return
    if (event.button !== 0 || event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    if (target && target.closest('button, a, input, textarea, select, [data-ignore-row-select="true"]')) {
      return
    }
    const resolved = resolveLineTarget(event.target)
    if (!resolved) return
    onLineMouseDown({ lineNum: resolved.lineNum, side: resolved.side, filePath, event })
  }

  const handleRowMouseEnter = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!onLineMouseEnter) return
    const resolved = resolveLineTarget(event.target)
    if (!resolved) return
    onLineMouseEnter({ lineNum: resolved.lineNum, side: resolved.side, filePath })
  }

  const handleOldLineContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (!oldLineNumber || !onLineNumberContextMenu) return
    onLineNumberContextMenu({ event, lineNumber: oldLineNumber, side: 'old' })
  }

  const handleNewLineContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (!newLineNumber || !onLineNumberContextMenu) return
    onLineNumberContextMenu({ event, lineNumber: newLineNumber, side: 'new' })
  }

  const handleOldCodeContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (!oldLineNumber || !onCodeContextMenu) return
    onCodeContextMenu({ event, lineNumber: oldLineNumber, side: 'old', content: leftContent })
  }

  const handleNewCodeContextMenu = (event: React.MouseEvent<HTMLTableCellElement>) => {
    if (!newLineNumber || !onCodeContextMenu) return
    onCodeContextMenu({ event, lineNumber: newLineNumber, side: 'new', content: rightContent })
  }

  const leftBg = left.type === 'removed' ? theme.colors.diff.removedBg : undefined
  const rightBg = right.type === 'added' ? theme.colors.diff.addedBg : undefined

  const leftBorder = left.type === 'removed' ? theme.colors.accent.red.border : undefined
  const rightBorder = right.type === 'added' ? theme.colors.accent.green.border : undefined

  const rowStyle: React.CSSProperties | undefined = showFocusIndicator
    ? { boxShadow: `inset 0 0 0 1px ${theme.colors.border.focus}` }
    : undefined

  return (
    <tr
      className={clsx(
        'group',
        isPrimaryKeyboardFocused && 'bg-slate-800/70',
        primary?.lineNum && onLineMouseDown ? 'cursor-pointer' : 'cursor-default',
      )}
      data-line-num={primary?.lineNum}
      data-side={primary?.side}
      style={rowStyle}
      onMouseLeave={triggerMouseLeave}
      onMouseDown={handleRowMouseDown}
      onMouseEnter={handleRowMouseEnter}
      onMouseUp={(event) => onLineMouseUp?.({ event, filePath })}
    >
      {/* Row selection */}
      <td className="w-7 pr-0.5 text-right select-none">
        {primary?.lineNum && onLineMouseDown && (
          <button
            onMouseDown={(e) => onLineMouseDown({ lineNum: primary.lineNum, side: primary.side, filePath, event: e })}
            className={clsx(
              'p-1 rounded text-white',
              (showFocusIndicator || isOldSelected || isNewSelected) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            style={{
              backgroundColor: theme.colors.accent.blue.DEFAULT,
              color: theme.colors.text.primary,
            }}
            aria-label={`Select line ${primary.lineNum}`}
            title="Click to select line, drag to select range, or press Enter to comment"
          >
            <VscAdd className="text-sm" />
          </button>
        )}
      </td>
      {/* Old side */}
      <td
        className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono"
        onContextMenu={handleOldLineContextMenu}
        style={isOldSelected ? { backgroundColor: theme.colors.selection.bg } : undefined}
        data-split-side="old"
      >
        {oldLineNumber ?? ''}
      </td>
      <td
        className="w-6 text-center select-none font-mono font-bold"
        style={{ color: left.type === 'removed' ? theme.colors.diff.removedText : undefined }}
        data-split-side="old"
      >
        {left.type === 'removed' ? '-' : ''}
      </td>
      <td
        className="px-2 py-0.5 font-mono text-sm relative align-top"
        onContextMenu={handleOldCodeContextMenu}
        style={{
          backgroundColor: isOldSelected ? theme.colors.selection.bg : leftBg,
          borderLeft: leftBorder ? `3px solid ${leftBorder}` : undefined,
        }}
        data-split-side="old"
      >
        {highlightedLeft ? (
          <code
            className="hljs block max-w-full whitespace-pre-wrap break-words diff-line-code"
            dangerouslySetInnerHTML={{ __html: highlightedLeft }}
          />
        ) : (
          <code className="text-slate-200 block max-w-full whitespace-pre-wrap break-words diff-line-code">
            {leftContent}
          </code>
        )}
      </td>

      {/* Separator */}
      <td
        className="w-px"
        style={{
          backgroundColor: theme.colors.border.subtle,
        }}
      />

      {/* New side */}
      <td
        className="w-12 px-2 py-0.5 text-slate-400 text-right select-none text-xs font-mono"
        onContextMenu={handleNewLineContextMenu}
        style={isNewSelected ? { backgroundColor: theme.colors.selection.bg } : undefined}
        data-split-side="new"
      >
        {newLineNumber ?? ''}
      </td>
      <td
        className="w-6 text-center select-none font-mono font-bold"
        style={{ color: right.type === 'added' ? theme.colors.diff.addedText : undefined }}
        data-split-side="new"
      >
        {right.type === 'added' ? '+' : ''}
      </td>
      <td
        className="px-2 py-0.5 font-mono text-sm relative align-top"
        onContextMenu={handleNewCodeContextMenu}
        style={{
          backgroundColor: isNewSelected ? theme.colors.selection.bg : rightBg,
          borderLeft: rightBorder ? `3px solid ${rightBorder}` : undefined,
        }}
        data-split-side="new"
      >
        {highlightedRight ? (
          <code
            className="hljs block max-w-full whitespace-pre-wrap break-words diff-line-code"
            dangerouslySetInnerHTML={{ __html: highlightedRight }}
          />
        ) : (
          <code className="text-slate-200 block max-w-full whitespace-pre-wrap break-words diff-line-code">
            {rightContent}
          </code>
        )}
      </td>
    </tr>
  )
}

function areEqual(prev: SplitDiffLineRowProps, next: SplitDiffLineRowProps) {
  const keys: ReadonlyArray<keyof SplitDiffLineRowProps> = [
    'left',
    'right',
    'index',
    'filePath',
    'isOldSelected',
    'isNewSelected',
    'highlightedLeft',
    'highlightedRight',
    'isPrimaryKeyboardFocused',
    'isPrimaryHovered',
    'onLineMouseDown',
    'onLineMouseEnter',
    'onLineMouseLeave',
    'onLineMouseUp',
    'onLineNumberContextMenu',
    'onCodeContextMenu',
  ]

  for (const key of keys) {
    if (prev[key] !== next[key]) return false
  }

  return true
}

export const SplitDiffLineRow = memo(SplitDiffLineRowComponent, areEqual)
