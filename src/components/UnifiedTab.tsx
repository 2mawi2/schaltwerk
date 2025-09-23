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
  isRunTab?: boolean
  isRunning?: boolean
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
  style,
  isRunTab = false,
  isRunning = false
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
        relative h-full flex items-center cursor-pointer group min-w-0 ${className}
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${isActive
          ? 'text-white'
          : 'text-slate-300 hover:text-white'
        }
      `}
      style={{
        backgroundColor: isActive
          ? theme.colors.background.elevated
          : 'transparent',
        borderRight: `1px solid ${theme.colors.border.subtle}`,
        borderTop: isActive
          ? isRunTab && isRunning
            ? `3px solid ${theme.colors.accent.cyan.DEFAULT}`
            : `3px solid ${theme.colors.accent.blue.DEFAULT}`
          : `3px solid transparent`,
        borderTopLeftRadius: isActive ? theme.borderRadius.md : '0',
        borderTopRightRadius: isActive ? theme.borderRadius.md : '0',
        paddingLeft: '16px',
        paddingRight: '16px',
        paddingTop: '6px',
        paddingBottom: '6px',
        fontSize: '0.875rem',
        fontWeight: isActive ? '600' : '500',
        minWidth: style?.minWidth || '80px',
        maxWidth: style?.maxWidth || '150px',
        boxShadow: isActive
          ? isRunTab && isRunning
            ? `0 2px 8px ${theme.colors.accent.cyan.bg}`
            : `0 2px 8px ${theme.colors.accent.blue.bg}`
          : 'none',
        backdropFilter: isActive ? 'blur(4px)' : 'none',
        transform: 'translateY(0)',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        ...style,
      }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title={title || label}
    >
      {/* Active tab background gradient */}
      {isActive && (
        <div
          className="absolute inset-0 rounded-t-md opacity-20"
          style={{
            background: isRunTab && isRunning
              ? `linear-gradient(135deg, ${theme.colors.accent.cyan.bg} 0%, ${theme.colors.accent.cyan.border} 100%)`
              : `linear-gradient(135deg, ${theme.colors.accent.blue.bg} 0%, ${theme.colors.accent.blue.border} 100%)`,
          }}
        />
      )}

      {/* Tab content */}
      <div className="relative z-10 flex items-center w-full">
        <span className="truncate flex-1 font-medium">
          {label}
        </span>

        {showCloseButton && onClose && (
          <button
            onClick={handleClose}
            className={`
              ml-2 w-4 h-4 flex items-center justify-center rounded-full
              ${isActive
                ? 'text-slate-300 hover:text-white hover:bg-white/20'
                : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white hover:bg-slate-600/60'
              }
            `}
            style={{
              fontSize: '14px',
              backgroundColor: 'transparent',
              fontWeight: 'bold',
              lineHeight: 1,
            }}
            title={`Close ${label}`}
            disabled={disabled}
          >
            ×
          </button>
        )}
      </div>

      {/* Hover effect overlay */}
      <div
        className={`
          absolute inset-0 rounded-t-md transition-opacity duration-200 pointer-events-none
          ${isActive ? 'opacity-0' : 'opacity-0 group-hover:opacity-10'}
        `}
        style={{
          backgroundColor: isRunTab && isRunning
            ? theme.colors.accent.cyan.DEFAULT
            : theme.colors.accent.blue.DEFAULT,
        }}
      />
    </div>
  )
}
