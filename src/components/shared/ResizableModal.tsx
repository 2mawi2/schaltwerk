import React, { useState, useEffect, useRef, ReactNode } from 'react'
import { theme } from '../../common/theme'

interface ResizableModalProps {
  isOpen: boolean
  onClose: () => void
  title: string | ReactNode
  children: ReactNode
  storageKey: string
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  footer?: ReactNode
  className?: string
}

interface ModalSize {
  width: number
  height: number
}

export const ResizableModal: React.FC<ResizableModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  storageKey,
  defaultWidth = 720,
  defaultHeight = 600,
  minWidth = 400,
  minHeight = 300,
  maxWidth = window.innerWidth * 0.95,
  maxHeight = window.innerHeight * 0.95,
  footer,
  className = ''
}) => {
  const [size, setSize] = useState<ModalSize>(() => {
    const stored = localStorage.getItem(`modal-size-${storageKey}`)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ModalSize
        return {
          width: Math.max(minWidth, Math.min(maxWidth, parsed.width)),
          height: Math.max(minHeight, Math.min(maxHeight, parsed.height))
        }
      } catch {
        return { width: defaultWidth, height: defaultHeight }
      }
    }
    return { width: defaultWidth, height: defaultHeight }
  })

  const [isResizing, setIsResizing] = useState(false)
  const [resizeDirection, setResizeDirection] = useState<string>('')
  const resizeStartPos = useRef({ x: 0, y: 0 })
  const resizeStartSize = useRef({ width: 0, height: 0 })
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onClose])

  useEffect(() => {
    localStorage.setItem(`modal-size-${storageKey}`, JSON.stringify(size))
  }, [size, storageKey])

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    setResizeDirection(direction)
    resizeStartPos.current = { x: e.clientX, y: e.clientY }
    resizeStartSize.current = { width: size.width, height: size.height }
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStartPos.current.x
      const deltaY = e.clientY - resizeStartPos.current.y

      let newWidth = resizeStartSize.current.width
      let newHeight = resizeStartSize.current.height

      if (resizeDirection.includes('e')) {
        newWidth = resizeStartSize.current.width + deltaX
      }
      if (resizeDirection.includes('w')) {
        newWidth = resizeStartSize.current.width - deltaX
      }
      if (resizeDirection.includes('s')) {
        newHeight = resizeStartSize.current.height + deltaY
      }
      if (resizeDirection.includes('n')) {
        newHeight = resizeStartSize.current.height - deltaY
      }

      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))

      setSize({ width: newWidth, height: newHeight })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setResizeDirection('')
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, resizeDirection, minWidth, minHeight, maxWidth, maxHeight])

  if (!isOpen) return null

  const ResizeHandle: React.FC<{ direction: string; className: string; cursor: string }> = ({
    direction,
    className,
    cursor
  }) => (
    <div
      className={className}
      style={{ cursor }}
      onMouseDown={(e) => handleResizeStart(e, direction)}
    />
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: theme.colors.overlay.backdrop }}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={`relative flex flex-col rounded-xl shadow-xl ${className}`}
        style={{
          width: `${size.width}px`,
          height: `${size.height}px`,
          backgroundColor: theme.colors.background.tertiary,
          borderColor: theme.colors.border.subtle,
          border: '1px solid',
          userSelect: isResizing ? 'none' : 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 border-b font-medium flex items-center justify-between"
          style={{
            borderBottomColor: theme.colors.border.default,
            color: theme.colors.text.primary
          }}
        >
          <span>{title}</span>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors hover:bg-opacity-10"
            style={{
              color: theme.colors.text.secondary,
              backgroundColor: 'transparent'
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = theme.colors.background.hover)
            }
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto">{children}</div>

        {footer && (
          <div
            className="px-4 py-3 border-t flex justify-end gap-2"
            style={{ borderTopColor: theme.colors.border.default }}
          >
            {footer}
          </div>
        )}

        <ResizeHandle direction="e" className="absolute top-0 right-0 w-1 h-full" cursor="ew-resize" />
        <ResizeHandle direction="w" className="absolute top-0 left-0 w-1 h-full" cursor="ew-resize" />
        <ResizeHandle direction="s" className="absolute bottom-0 left-0 w-full h-1" cursor="ns-resize" />
        <ResizeHandle direction="n" className="absolute top-0 left-0 w-full h-1" cursor="ns-resize" />
        <ResizeHandle direction="se" className="absolute bottom-0 right-0 w-4 h-4" cursor="nwse-resize" />
        <ResizeHandle direction="sw" className="absolute bottom-0 left-0 w-4 h-4" cursor="nesw-resize" />
        <ResizeHandle direction="ne" className="absolute top-0 right-0 w-4 h-4" cursor="nesw-resize" />
        <ResizeHandle direction="nw" className="absolute top-0 left-0 w-4 h-4" cursor="nwse-resize" />

        <div
          className="absolute bottom-1 right-1 pointer-events-none opacity-30"
          style={{ color: theme.colors.text.tertiary }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M15 9v2h-2V9h2zm0 4v2h-2v-2h2zm-4 0v2H9v-2h2zm0-4v2H9V9h2zM7 13v2H5v-2h2z" />
          </svg>
        </div>
      </div>
    </div>
  )
}
