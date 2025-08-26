import { useState, useRef, useCallback, useEffect } from 'react'

interface SearchMatch {
  element: Element
  originalHTML: string
  textContent: string
  index: number
}

interface SearchBoxProps {
  targetRef: React.RefObject<HTMLElement | null>
  isVisible: boolean
  onClose: () => void
  className?: string
}

export function SearchBox({ targetRef, isVisible, onClose, className = '' }: SearchBoxProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [totalMatches, setTotalMatches] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const clearHighlights = useCallback(() => {
    setMatches(prevMatches => {
      prevMatches.forEach(match => {
        if (match.element && match.element.parentNode) {
          match.element.innerHTML = match.originalHTML
        }
      })
      return []
    })
    setCurrentMatchIndex(-1)
    setTotalMatches(0)
  }, [])

  const highlightMatches = useCallback((term: string) => {
    if (!targetRef.current || !term.trim()) {
      clearHighlights()
      return
    }

    clearHighlights()

    const container = targetRef.current
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    )

    const textNodes: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text)
    }

    const newMatches: SearchMatch[] = []
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

    textNodes.forEach((textNode) => {
      const parent = textNode.parentElement
      if (!parent) return

      const text = textNode.textContent || ''
      const matches = Array.from(text.matchAll(regex))

      if (matches.length > 0) {
        const originalHTML = parent.innerHTML
        let highlightedHTML = text

        matches.reverse().forEach((match) => {
          const start = match.index!
          const end = start + match[0].length
          const before = highlightedHTML.substring(0, start)
          const matchText = highlightedHTML.substring(start, end)
          const after = highlightedHTML.substring(end)
          
          highlightedHTML = `${before}<mark class="bg-yellow-400 text-black">${matchText}</mark>${after}`
        })

        parent.innerHTML = highlightedHTML
        newMatches.push({
          element: parent,
          originalHTML,
          textContent: text,
          index: newMatches.length
        })
      }
    })

    setMatches(newMatches)
    setTotalMatches(newMatches.length)
    setCurrentMatchIndex(newMatches.length > 0 ? 0 : -1)

    if (newMatches.length > 0) {
      scrollToMatch(0, newMatches)
    }
  }, [targetRef, clearHighlights])

  const scrollToMatch = useCallback((matchIndex: number, matchList: SearchMatch[] = matches) => {
    if (matchIndex < 0 || matchIndex >= matchList.length) return

    const match = matchList[matchIndex]
    const markElement = match.element.querySelector('mark')
    if (markElement) {
      markElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      
      // Update highlight styles to show current match
      matchList.forEach((m, i) => {
        const marks = m.element.querySelectorAll('mark')
        marks.forEach(mark => {
          if (i === matchIndex) {
            mark.className = 'bg-orange-400 text-black'
          } else {
            mark.className = 'bg-yellow-400 text-black'
          }
        })
      })
    }
  }, [matches])

  const findNext = useCallback(() => {
    if (totalMatches === 0) return
    const nextIndex = (currentMatchIndex + 1) % totalMatches
    setCurrentMatchIndex(nextIndex)
    scrollToMatch(nextIndex)
  }, [currentMatchIndex, totalMatches, scrollToMatch])

  const findPrevious = useCallback(() => {
    if (totalMatches === 0) return
    const prevIndex = currentMatchIndex <= 0 ? totalMatches - 1 : currentMatchIndex - 1
    setCurrentMatchIndex(prevIndex)
    scrollToMatch(prevIndex)
  }, [currentMatchIndex, totalMatches, scrollToMatch])

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term)
    highlightMatches(term)
  }, [highlightMatches])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        findPrevious()
      } else {
        findNext()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [findNext, findPrevious, onClose])

  const handleClose = useCallback(() => {
    clearHighlights()
    setSearchTerm('')
    onClose()
  }, [clearHighlights, onClose])

  // Auto-focus input when search becomes visible
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isVisible])

  // Clean up highlights when component unmounts or search closes
  useEffect(() => {
    if (!isVisible) {
      clearHighlights()
    }
  }, [isVisible, clearHighlights])

  if (!isVisible) return null

  return (
    <div className={`absolute top-2 right-2 flex items-center bg-panel border border-slate-700 rounded px-2 py-1 z-10 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => handleSearch(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="bg-transparent text-sm text-slate-200 outline-none w-40"
      />
      
      {totalMatches > 0 && (
        <div className="text-xs text-slate-400 ml-2 whitespace-nowrap">
          {currentMatchIndex + 1}/{totalMatches}
        </div>
      )}
      
      <button 
        onClick={findPrevious}
        className="text-slate-400 hover:text-slate-200 ml-1 disabled:opacity-50"
        title="Previous match (Shift+Enter)"
        disabled={totalMatches === 0}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M7 12L3 8L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      
      <button 
        onClick={findNext}
        className="text-slate-400 hover:text-slate-200 ml-1 disabled:opacity-50"
        title="Next match (Enter)"
        disabled={totalMatches === 0}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M9 4L13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      
      <button 
        onClick={handleClose}
        className="text-slate-400 hover:text-slate-200 ml-2"
        title="Close search (Escape)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}