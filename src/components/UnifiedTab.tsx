import React, { useState } from 'react'
import { theme } from '../common/theme'

export interface UnifiedTabProps {
  id: string | number
  label: string
  labelContent?: React.ReactNode
  isActive: boolean
  onSelect: () => void
  onClose?: () => void
  onMiddleClick?: () => void
  showCloseButton?: boolean
  disabled?: boolean
  className?: string
  badgeContent?: React.ReactNode
  title?: string
  style?: React.CSSProperties
  isRunTab?: boolean
  isRunning?: boolean
  statusIndicator?: React.ReactNode
}

export function UnifiedTab({
  label,
  labelContent,
  isActive,
  onSelect,
  onClose,
  onMiddleClick,
  showCloseButton = true,
  disabled = false,
  className = '',
  badgeContent,
  title,
  style,
  isRunTab = false,
  isRunning = false,
  statusIndicator,
}: UnifiedTabProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isCloseHovered, setIsCloseHovered] = useState(false)

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

  const getBackgroundColor = () => {
    if (isActive) return 'var(--color-tab-active-bg)'
    if (isHovered && !disabled) return 'var(--color-tab-inactive-hover-bg)'
    return 'var(--color-tab-inactive-bg)'
  }

  const getTextColor = () => {
    if (isActive) return 'var(--color-tab-active-text)'
    if (isHovered && !disabled) return 'var(--color-tab-inactive-hover-text)'
    return 'var(--color-tab-inactive-text)'
  }

  return (
    <div
      className={`
        relative h-full flex items-center cursor-pointer group min-w-0 select-none
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${className}
      `}
      style={{
        backgroundColor: getBackgroundColor(),
        color: getTextColor(),
        borderRight: '1px solid var(--color-border-subtle)',
        paddingLeft: '12px',
        paddingRight: '8px',
        minWidth: style?.minWidth || '80px',
        maxWidth: style?.maxWidth || '150px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        transition: 'background-color 150ms ease-out, color 150ms ease-out',
        ...style,
      }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title || label}
    >
      {/* Bottom active indicator */}
      <div
        className="absolute left-0 right-0 bottom-0 h-[2px]"
        style={{
          backgroundColor: isRunTab && isRunning
            ? 'var(--color-tab-running-indicator)'
            : 'var(--color-tab-active-indicator)',
          opacity: isActive ? 1 : 0,
          transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
        }}
      />

      {/* Running glow effect */}
      {isRunTab && isRunning && isActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, var(--color-tab-running-glow) 0%, transparent 50%)',
          }}
        />
      )}

      {/* Tab Content */}
      <div className="relative z-10 flex items-center w-full gap-2 overflow-hidden">
        {statusIndicator && (
          <span className="flex items-center justify-center shrink-0" aria-hidden="true">
            {statusIndicator}
          </span>
        )}

        <span
          className="truncate flex-1 min-w-0"
          style={{
            fontSize: theme.fontSize.terminal,
            fontWeight: isActive ? 500 : 400,
            lineHeight: '1.5',
            fontFamily: theme.fontFamily.sans,
          }}
        >
          {labelContent ?? label}
        </span>

        {badgeContent && (
          <span
            className="inline-flex items-center justify-center px-1.5 rounded-full font-medium shrink-0"
            style={{
              fontSize: theme.fontSize.caption,
              height: '16px',
              minWidth: '16px',
              backgroundColor: 'var(--color-tab-badge-bg)',
              color: 'var(--color-tab-badge-text)',
            }}
          >
            {badgeContent}
          </span>
        )}

        {showCloseButton && onClose && (
          <button
            onClick={handleClose}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            className="shrink-0 flex items-center justify-center w-5 h-5 rounded"
            style={{
              fontSize: theme.fontSize.body,
              lineHeight: 1,
              backgroundColor: isCloseHovered
                ? 'var(--color-tab-close-hover-bg)'
                : 'var(--color-tab-close-bg)',
              color: isCloseHovered
                ? 'var(--color-tab-close-hover-color)'
                : 'var(--color-tab-close-color)',
              opacity: isActive || isHovered ? 1 : 0,
              transition: 'opacity 150ms ease-out, background-color 100ms ease-out, color 100ms ease-out',
            }}
            title={`Close ${label}`}
            disabled={disabled}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
