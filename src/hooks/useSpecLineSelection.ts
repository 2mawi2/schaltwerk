import { useState, useCallback, useRef } from 'react'

export interface SpecLineSelection {
  startLine: number
  endLine: number
  specId: string
}

export function useSpecLineSelection() {
  const [selection, setSelection] = useState<SpecLineSelection | null>(null)
  const lastClickedLine = useRef<{ line: number; specId: string } | null>(null)

  const handleLineClick = useCallback((lineNum: number, specId: string, event?: MouseEvent | React.MouseEvent) => {
    const isShiftClick = event?.shiftKey

    if (isShiftClick &&
        lastClickedLine.current &&
        lastClickedLine.current.specId === specId) {
      const start = Math.min(lastClickedLine.current.line, lineNum)
      const end = Math.max(lastClickedLine.current.line, lineNum)
      setSelection({ startLine: start, endLine: end, specId })
    } else if (selection && selection.specId === specId &&
               lineNum >= selection.startLine && lineNum <= selection.endLine) {
      setSelection(null)
      lastClickedLine.current = null
    } else {
      setSelection({ startLine: lineNum, endLine: lineNum, specId })
      lastClickedLine.current = { line: lineNum, specId }
    }
  }, [selection])

  const extendSelection = useCallback((lineNum: number, specId: string) => {
    if (!selection || selection.specId !== specId) {
      setSelection({ startLine: lineNum, endLine: lineNum, specId })
      lastClickedLine.current = { line: lineNum, specId }
    } else {
      const start = Math.min(selection.startLine, lineNum)
      const end = Math.max(selection.endLine, lineNum)
      setSelection({ startLine: start, endLine: end, specId })
    }
  }, [selection])

  const clearSelection = useCallback(() => {
    setSelection(null)
    lastClickedLine.current = null
  }, [])

  const isLineSelected = useCallback((specId: string, lineNum: number | undefined) => {
    if (!selection || !lineNum || selection.specId !== specId) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])

  return {
    selection,
    handleLineClick,
    extendSelection,
    clearSelection,
    isLineSelected
  }
}
