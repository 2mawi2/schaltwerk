import { useEffect, useCallback, useRef } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { VscClose } from 'react-icons/vsc'
import { KanbanView } from './KanbanView'

interface KanbanModalProps {
  isOpen: boolean
  onClose: () => void
}

export function KanbanModal({ isOpen, onClose }: KanbanModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    if (isOpen) {
      // Prevent keyboard events from propagating to the main app
      const stopPropagation = (e: KeyboardEvent) => {
        // Allow ESC to close the modal
        if (e.key === 'Escape') return
        
        // Stop all other keyboard events from reaching the main app
        e.stopPropagation()
      }

      window.addEventListener('keydown', handleKeyDown, true)
      modalRef.current?.addEventListener('keydown', stopPropagation, true)
      
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
        modalRef.current?.removeEventListener('keydown', stopPropagation, true)
      }
    }
  }, [isOpen, onClose])

  // Click outside to close
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className="relative w-[95vw] h-[90vh] max-w-[1600px] bg-slate-900 rounded-lg shadow-2xl flex flex-col animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white">Agent Board</h2>
            <span className="text-sm text-slate-400">Drag agents and specs between columns to change their status</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
            title="Close (ESC)"
          >
            <VscClose className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <DndProvider backend={HTML5Backend}>
            <KanbanView />
          </DndProvider>
        </div>
      </div>
    </div>
  )
}