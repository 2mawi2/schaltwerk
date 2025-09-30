import { forwardRef } from 'react'
import type { KeyboardEvent } from 'react'

type Props = {
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onFindNext: () => void
  onFindPrevious: () => void
  onClose: () => void
}

export const TerminalSearchPanel = forwardRef<HTMLDivElement, Props>(
  ({ searchTerm, onSearchTermChange, onFindNext, onFindPrevious, onClose }, ref) => {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === 'Enter') {
        if (event.shiftKey) {
          onFindPrevious()
        } else {
          onFindNext()
        }
      }
    }

    return (
      <div
        ref={ref}
        data-terminal-search="true"
        className="absolute top-2 right-2 flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 z-10 shadow-lg"
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="bg-transparent text-sm text-slate-200 outline-none w-40 placeholder:text-slate-500"
          autoFocus
        />
        <button
          onClick={onFindPrevious}
          className="text-slate-400 hover:text-slate-200 ml-1"
          title="Previous match (Shift+Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7 12L3 8L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onFindNext}
          className="text-slate-400 hover:text-slate-200 ml-1"
          title="Next match (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M9 4L13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 ml-2"
          title="Close search (Escape)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    )
  }
)

TerminalSearchPanel.displayName = 'TerminalSearchPanel'
