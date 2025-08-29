import { useState, useCallback, useEffect, useRef } from 'react'

export interface HoveredLine {
  lineNum: number
  side: 'old' | 'new'
  filePath: string
}

export function useDiffHover() {
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null)
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const setHoveredLineInfo = useCallback((lineNum: number | null, side: 'old' | 'new' | null, filePath: string | null) => {
    // Clear any pending clear timeout
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current)
      clearTimeoutRef.current = null
    }
    
    if (lineNum && side && filePath) {
      setHoveredLine({ lineNum, side, filePath })
    } else {
      setHoveredLine(null)
    }
  }, [])
  
  const clearHoveredLine = useCallback(() => {
    // Add a small delay before clearing to handle quick mouse movements during key press
    clearTimeoutRef.current = setTimeout(() => {
      setHoveredLine(null)
    }, 100)
  }, [])
  
  const useHoverKeyboardShortcuts = useCallback((
    onStartComment: (lineNum: number, side: 'old' | 'new', filePath: string) => void,
    isModalOpen: boolean = true
  ) => {
    useEffect(() => {
      if (!isModalOpen) return
      
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const activeElement = document.activeElement as HTMLElement
          if (activeElement?.tagName === 'INPUT' || 
              activeElement?.tagName === 'TEXTAREA' || 
              activeElement?.contentEditable === 'true') {
            return
          }
          
          // Find the currently hovered line directly from the DOM using CSS :hover selector
          const hoveredRow = document.querySelector('tr:hover[data-line-num][data-side]') as HTMLElement
          if (hoveredRow) {
            const lineNum = parseInt(hoveredRow.getAttribute('data-line-num') || '0')
            const side = hoveredRow.getAttribute('data-side') as 'old' | 'new'
            
            // Get the selected file from the modal context
            const modal = document.querySelector('[data-testid="diff-modal"]') as HTMLElement
            const selectedFile = modal?.getAttribute('data-selected-file')
            
            if (lineNum && side && selectedFile) {
              event.preventDefault()
              event.stopPropagation()
              onStartComment(lineNum, side, selectedFile)
              return
            }
          }
          
          // Fallback to hover state if DOM detection fails
          if (hoveredLine) {
            event.preventDefault()
            event.stopPropagation()
            onStartComment(hoveredLine.lineNum, hoveredLine.side, hoveredLine.filePath)
          }
        }
      }
      
      // Always add the event listener when modal is open
      // Use capture phase to ensure we get the event before other handlers
      document.addEventListener('keydown', handleKeyDown, true)
      
      return () => {
        document.removeEventListener('keydown', handleKeyDown, true)
        // Clean up any pending timeout
        if (clearTimeoutRef.current) {
          clearTimeout(clearTimeoutRef.current)
          clearTimeoutRef.current = null
        }
      }
    }, [hoveredLine, onStartComment, isModalOpen])
  }, [])
  
  return {
    hoveredLine,
    setHoveredLineInfo,
    clearHoveredLine,
    useHoverKeyboardShortcuts
  }
}