import React, { useState, useRef, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { logger } from '../../utils/logger'
import { validateDisplayName } from '../../utils/sanitizeName'

interface InlineEditableTextProps {
  value: string
  onSave: (newValue: string) => Promise<void>
  placeholder?: string
  maxLength?: number
  className?: string
  textStyle?: React.CSSProperties
  disabled?: boolean
}

export function InlineEditableText({
  value,
  onSave,
  placeholder = 'Enter name...',
  maxLength = 30,
  className,
  textStyle,
  disabled = false,
}: InlineEditableTextProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(value)
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim()
    if (trimmed === value) {
      setIsEditing(false)
      setError(null)
      return
    }

    const validationError = validateDisplayName(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await onSave(trimmed)
      setIsEditing(false)
    } catch (e) {
      logger.error('Failed to save inline edit:', e)
      setError(e instanceof Error ? e.message : 'Failed to save')
      inputRef.current?.focus()
    } finally {
      setIsSaving(false)
    }
  }, [editValue, value, onSave])

  const handleCancel = useCallback(() => {
    setEditValue(value)
    setIsEditing(false)
    setError(null)
  }, [value])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const handleBlur = useCallback(() => {
    if (!isSaving) {
      void handleSave()
    }
  }, [isSaving, handleSave])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || isSaving) return
      e.stopPropagation()
      setIsEditing(true)
    },
    [disabled, isSaving]
  )

  if (isEditing) {
    return (
      <div className={clsx('inline-flex items-center gap-1', className)}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={isSaving}
          className={clsx(
            'bg-elevated border rounded px-1.5 py-0.5 outline-none',
            'min-w-[120px] max-w-[200px]',
            error ? 'border-accent-red' : 'border-subtle focus:border-accent-blue',
            isSaving && 'opacity-50'
          )}
          style={{
            ...textStyle,
            color: 'var(--color-text-primary)',
          }}
          onClick={(e) => e.stopPropagation()}
        />
        {isSaving && (
          <span
            className="h-3 w-3 border-2 border-solid rounded-full animate-spin flex-shrink-0"
            style={{
              borderColor: 'var(--color-accent-blue-border)',
              borderTopColor: 'transparent',
            }}
          />
        )}
      </div>
    )
  }

  return (
    <span
      tabIndex={disabled ? -1 : 0}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          setIsEditing(true)
        }
      }}
      className={clsx(
        'truncate cursor-pointer hover:bg-hover rounded px-0.5 -mx-0.5 transition-colors',
        disabled && 'cursor-default hover:bg-transparent',
        className
      )}
      style={textStyle}
      title={disabled ? undefined : 'Double-click to rename'}
    >
      {value || placeholder}
    </span>
  )
}
