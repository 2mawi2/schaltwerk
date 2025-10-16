import { useState, useCallback, useRef } from 'react'

export interface LineSelection {
  startLine: number
  endLine: number
  side: 'old' | 'new'
  filePath: string
}

export function useLineSelection() {
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const lastClickedLine = useRef<{ line: number; side: 'old' | 'new'; filePath: string } | null>(null)

  const handleLineClick = useCallback((lineNum: number, side: 'old' | 'new', filePath: string, event?: MouseEvent | React.MouseEvent) => {
    const isShiftClick = event?.shiftKey

    if (isShiftClick &&
        lastClickedLine.current &&
        lastClickedLine.current.side === side &&
        lastClickedLine.current.filePath === filePath) {
      // Shift+click: extend selection
      const start = Math.min(lastClickedLine.current.line, lineNum)
      const end = Math.max(lastClickedLine.current.line, lineNum)
      setSelection({ startLine: start, endLine: end, side, filePath })
    } else if (selection && selection.side === side && selection.filePath === filePath &&
               lineNum >= selection.startLine && lineNum <= selection.endLine) {
      // Clicking within current selection: clear it
      setSelection(null)
      lastClickedLine.current = null
    } else {
      // Regular click: select single line
      setSelection({ startLine: lineNum, endLine: lineNum, side, filePath })
      lastClickedLine.current = { line: lineNum, side, filePath }
    }
  }, [selection])

  const extendSelection = useCallback((lineNum: number, side: 'old' | 'new', filePath: string) => {
    if (!selection || selection.side !== side || selection.filePath !== filePath) {
      // Start new selection
      setSelection({ startLine: lineNum, endLine: lineNum, side, filePath })
      lastClickedLine.current = { line: lineNum, side, filePath }
    } else {
      // Extend existing selection
      const start = Math.min(selection.startLine, lineNum)
      const end = Math.max(selection.endLine, lineNum)
      setSelection({ startLine: start, endLine: end, side, filePath })
    }
  }, [selection])
  
  const clearSelection = useCallback(() => {
    setSelection(null)
    lastClickedLine.current = null
  }, [])
  
  const isLineSelected = useCallback((filePath: string, lineNum: number | undefined, side: 'old' | 'new') => {
    if (!selection || !lineNum || selection.side !== side || selection.filePath !== filePath) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])

  const isLineInRange = useCallback((filePath: string, lineNum: number | undefined) => {
    if (!selection || !lineNum || selection.filePath !== filePath) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])

  return {
    selection,
    handleLineClick,
    extendSelection,
    clearSelection,
    isLineSelected,
    isLineInRange
  }
}
