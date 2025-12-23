import React from 'react'
import { VscChevronDown, VscChevronRight } from 'react-icons/vsc'
import type { LineInfo } from '../../types/diff'
import { SplitDiffLineRow } from './SplitDiffLineRow'

const isSplitUnchangedPair = (left: LineInfo, right: LineInfo) =>
  left.type === 'unchanged' &&
  right.type === 'unchanged' &&
  left.oldLineNumber !== undefined &&
  right.newLineNumber !== undefined &&
  left.content === right.content

interface SplitDiffRowsProps {
  filePath: string
  leftLines: LineInfo[]
  rightLines: LineInfo[]
  expandedSet?: Set<number>
  toggleCollapsed: (filePath: string, index: number) => void
  isLineSelected: (filePath: string, lineNum: number, side: 'old' | 'new') => boolean
  highlightCode: (filePath: string, lineKey: string, code: string) => string | undefined
  handleLineMouseDown: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string; event: React.MouseEvent }) => void
  handleLineMouseEnter: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string }) => void
  handleLineMouseLeave: (payload: { filePath: string }) => void
  handleLineMouseUp: (payload: { event: React.MouseEvent | MouseEvent; filePath: string }) => void
  handleLineNumberContextMenu: (
    filePath: string,
    payload: { event: React.MouseEvent<HTMLTableCellElement>; lineNumber: number; side: 'old' | 'new' },
  ) => void
  handleCodeContextMenu: (
    filePath: string,
    payload: { event: React.MouseEvent<HTMLTableCellElement>; lineNumber: number; side: 'old' | 'new'; content: string },
  ) => void
  keyboardFocus?: { filePath: string; lineNum: number; side: 'old' | 'new' } | null
  hoveredLine?: { filePath: string; lineNum: number; side: 'old' | 'new' } | null
}

export function SplitDiffRows({
  filePath,
  leftLines,
  rightLines,
  expandedSet,
  toggleCollapsed,
  isLineSelected,
  highlightCode,
  handleLineMouseDown,
  handleLineMouseEnter,
  handleLineMouseLeave,
  handleLineMouseUp,
  handleLineNumberContextMenu,
  handleCodeContextMenu,
  keyboardFocus,
  hoveredLine,
}: SplitDiffRowsProps) {
  const rowCount = Math.max(leftLines.length, rightLines.length)
  const emptyLine: LineInfo = { type: 'unchanged', content: '' }

  const rows: React.ReactNode[] = []

  for (let idx = 0; idx < rowCount; idx += 1) {
    const left = leftLines[idx] ?? emptyLine
    const right = rightLines[idx] ?? emptyLine

    const oldLineNum = left.oldLineNumber
    const newLineNum = right.newLineNumber
    const isUnchangedPair = isSplitUnchangedPair(left, right)
    const baseKey = `${filePath}-${idx}`

    const isCollapsible = left.isCollapsible || right.isCollapsible
    const collapsedCount = left.collapsedCount ?? right.collapsedCount ?? 0
    const isExpanded = expandedSet?.has(idx) ?? false

    if (isCollapsible) {
      rows.push(
        <tr key={`${filePath}-split-collapse-${idx}`} className="hover:bg-slate-900/50 group">
          <td className="w-7 text-center select-none">
            <button
              onClick={() => toggleCollapsed(filePath, idx)}
              className="p-1 text-slate-600 hover:text-slate-400"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <VscChevronDown /> : <VscChevronRight />}
            </button>
          </td>
          <td className="w-12 px-2 py-0.5 text-slate-600 text-center select-none">...</td>
          <td className="w-6 px-2 py-0.5 text-slate-600 text-center select-none">...</td>
          <td colSpan={5} className="px-2 py-1">
            <button
              onClick={() => toggleCollapsed(filePath, idx)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              {collapsedCount} unchanged lines
            </button>
          </td>
        </tr>,
      )

      if (isExpanded) {
        const leftCollapsed = left.collapsedLines ?? []
        const rightCollapsed = right.collapsedLines ?? []
        const expandedCount = Math.max(leftCollapsed.length, rightCollapsed.length)

        for (let collapsedIdx = 0; collapsedIdx < expandedCount; collapsedIdx += 1) {
          const expandedLeft = leftCollapsed[collapsedIdx] ?? emptyLine
          const expandedRight = rightCollapsed[collapsedIdx] ?? emptyLine

          const expandedOldNum = expandedLeft.oldLineNumber
          const expandedNewNum = expandedRight.newLineNumber

          const isOldSelected = expandedOldNum ? isLineSelected(filePath, expandedOldNum, 'old') : false
          const isNewSelected = expandedNewNum ? isLineSelected(filePath, expandedNewNum, 'new') : false

          const primaryLineNum = expandedNewNum ?? expandedOldNum
          const primarySide: 'old' | 'new' = expandedNewNum ? 'new' : 'old'

          const isPrimaryKeyboardFocused = !!(
            primaryLineNum &&
            keyboardFocus?.filePath === filePath &&
            keyboardFocus.lineNum === primaryLineNum &&
            keyboardFocus.side === primarySide
          )

          const isPrimaryHovered = !!(
            primaryLineNum &&
            hoveredLine?.filePath === filePath &&
            hoveredLine.lineNum === primaryLineNum &&
            hoveredLine.side === primarySide
          )

          const expandedBaseKey = `${baseKey}-expanded-${collapsedIdx}`
          const isExpandedPair = isSplitUnchangedPair(expandedLeft, expandedRight)
          const leftKey = isExpandedPair ? expandedBaseKey : `${baseKey}-left-expanded-${collapsedIdx}`
          const rightKey = isExpandedPair ? expandedBaseKey : `${baseKey}-right-expanded-${collapsedIdx}`

          rows.push(
            <SplitDiffLineRow
              key={`${filePath}-split-${idx}-expanded-${collapsedIdx}`}
              left={expandedLeft}
              right={expandedRight}
              index={`${filePath}-${idx}-${collapsedIdx}`}
              filePath={filePath}
              isOldSelected={isOldSelected}
              isNewSelected={isNewSelected}
              onLineMouseDown={handleLineMouseDown}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseLeave={handleLineMouseLeave}
              onLineMouseUp={handleLineMouseUp}
              highlightedLeft={
                expandedLeft.content !== undefined ? highlightCode(filePath, leftKey, expandedLeft.content) : undefined
              }
              highlightedRight={
                expandedRight.content !== undefined ? highlightCode(filePath, rightKey, expandedRight.content) : undefined
              }
              onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(filePath, payload)}
              onCodeContextMenu={(payload) => handleCodeContextMenu(filePath, payload)}
              isPrimaryKeyboardFocused={isPrimaryKeyboardFocused}
              isPrimaryHovered={isPrimaryHovered}
            />,
          )
        }
      }

      continue
    }

    const isOldSelected = oldLineNum ? isLineSelected(filePath, oldLineNum, 'old') : false
    const isNewSelected = newLineNum ? isLineSelected(filePath, newLineNum, 'new') : false

    const primaryLineNum = newLineNum ?? oldLineNum
    const primarySide: 'old' | 'new' = newLineNum ? 'new' : 'old'

    const isPrimaryKeyboardFocused = !!(
      primaryLineNum &&
      keyboardFocus?.filePath === filePath &&
      keyboardFocus.lineNum === primaryLineNum &&
      keyboardFocus.side === primarySide
    )

    const isPrimaryHovered = !!(
      primaryLineNum &&
      hoveredLine?.filePath === filePath &&
      hoveredLine.lineNum === primaryLineNum &&
      hoveredLine.side === primarySide
    )

    const leftKey = isUnchangedPair ? baseKey : `${baseKey}-left`
    const rightKey = isUnchangedPair ? baseKey : `${baseKey}-right`

    rows.push(
      <SplitDiffLineRow
        key={`${filePath}-split-${idx}`}
        left={left}
        right={right}
        index={`${filePath}-${idx}`}
        filePath={filePath}
        isOldSelected={isOldSelected}
        isNewSelected={isNewSelected}
        onLineMouseDown={handleLineMouseDown}
        onLineMouseEnter={handleLineMouseEnter}
        onLineMouseLeave={handleLineMouseLeave}
        onLineMouseUp={handleLineMouseUp}
        highlightedLeft={left.content !== undefined ? highlightCode(filePath, leftKey, left.content) : undefined}
        highlightedRight={right.content !== undefined ? highlightCode(filePath, rightKey, right.content) : undefined}
        onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(filePath, payload)}
        onCodeContextMenu={(payload) => handleCodeContextMenu(filePath, payload)}
        isPrimaryKeyboardFocused={isPrimaryKeyboardFocused}
        isPrimaryHovered={isPrimaryHovered}
      />,
    )
  }

  return <>{rows}</>
}

