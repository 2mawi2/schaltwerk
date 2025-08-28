import React from 'react'
import { theme } from '../common/theme'

export interface UnifiedTabProps {
  id: string | number
  label: string
  isActive: boolean
  onSelect: () => void
  onClose?: () => void
  onMiddleClick?: () => void
  showCloseButton?: boolean
  disabled?: boolean
  className?: string
  title?: string
  style?: React.CSSProperties
}

export function UnifiedTab({ 
  label, 
  isActive, 
  onSelect, 
  onClose, 
  onMiddleClick,
  showCloseButton = true,
  disabled = false,
  className = '',
  title,
  style
}: UnifiedTabProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()
    onSelect()
  }

  const handleClose = (e: React.MouseEvent) => {
    if (!onClose) return
    e.stopPropagation()
    onClose()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.stopPropagation()
      if (onMiddleClick) {
        onMiddleClick()
      } else if (onClose) {
        onClose()
      }
    }
  }

  return (
    <div
      className={`
        relative h-full flex items-center cursor-pointer group transition-all duration-200 min-w-0 ${className}
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${isActive 
          ? 'text-slate-100' 
          : 'text-slate-300 hover:text-slate-100'
        }
      `}
      style={{
        backgroundColor: isActive ? theme.colors.background.elevated : theme.colors.background.secondary,
        borderRight: `1px solid ${theme.colors.border.default}`,
        borderTop: isActive ? `2px solid ${theme.colors.accent.blue.DEFAULT}` : `2px solid transparent`,
        paddingLeft: theme.spacing.md,
        paddingRight: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        fontSize: theme.fontSize.body,
        fontWeight: isActive ? '500' : '400',
        minWidth: '100px',
        maxWidth: '200px',
        ...style,
      }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title={title || label}
    >
      <span className="truncate flex-1">
        {label}
      </span>
      
      {showCloseButton && onClose && (
        <button
          onClick={handleClose}
          className={`
            ml-2 w-5 h-5 flex items-center justify-center rounded transition-all duration-200
            ${isActive 
              ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-600/60' 
              : 'opacity-0 group-hover:opacity-80 hover:!opacity-100 text-slate-400 hover:text-slate-100 hover:bg-slate-600/50'
            }
          `}
          style={{
            fontSize: theme.fontSize.body,
            backgroundColor: 'transparent'
          }}
          title={`Close ${label}`}
          disabled={disabled}
        >
          ×
        </button>
      )}
      
    </div>
  )
}