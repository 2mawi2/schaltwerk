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
        relative h-full flex items-center cursor-pointer group transition-all duration-300 ease-out min-w-0 ${className}
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${isActive
          ? 'text-white'
          : 'text-slate-300 hover:text-white'
        }
        hover:scale-[1.02] active:scale-[0.98]
      `}
      style={{
        backgroundColor: isActive
          ? theme.colors.background.elevated
          : 'transparent',
        borderRight: `1px solid ${theme.colors.border.subtle}`,
        borderTop: isActive
          ? `3px solid ${theme.colors.accent.blue.DEFAULT}`
          : `3px solid transparent`,
        borderTopLeftRadius: isActive ? theme.borderRadius.md : '0',
        borderTopRightRadius: isActive ? theme.borderRadius.md : '0',
        paddingLeft: theme.spacing.lg,
        paddingRight: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        fontSize: theme.fontSize.body,
        fontWeight: isActive ? '600' : '500',
        minWidth: '120px',
        maxWidth: '220px',
        boxShadow: isActive
          ? `0 4px 12px ${theme.colors.accent.blue.bg}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`
          : 'none',
        backdropFilter: isActive ? 'blur(8px)' : 'none',
        transform: isActive ? 'translateY(-1px)' : 'translateY(0)',
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
            background: `linear-gradient(135deg, ${theme.colors.accent.blue.bg} 0%, ${theme.colors.accent.blue.border} 100%)`,
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
              ml-3 w-6 h-6 flex items-center justify-center rounded-full transition-all duration-200
              ${isActive
                ? 'text-slate-300 hover:text-white hover:bg-white/20 hover:scale-110'
                : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white hover:bg-slate-600/60 hover:scale-110'
              }
              active:scale-95
            `}
            style={{
              fontSize: theme.fontSize.bodyLarge,
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
          backgroundColor: theme.colors.accent.blue.DEFAULT,
        }}
      />
    </div>
  )
}