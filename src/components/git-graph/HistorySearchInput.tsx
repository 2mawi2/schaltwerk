import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import type { KeyboardEvent, ChangeEvent } from 'react'
import { theme } from '../../common/theme'

interface HistorySearchInputProps {
  value: string
  onChange: (value: string) => void
  matchCount: number
  totalCount: number
  onClose: () => void
}

export interface HistorySearchInputHandle {
  focus: () => void
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation()

export const HistorySearchInput = forwardRef<HistorySearchInputHandle, HistorySearchInputProps>(
  function HistorySearchInput({ value, onChange, matchCount, totalCount, onClose }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [localValue, setLocalValue] = useState(value)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }))

    useEffect(() => {
      setLocalValue(value)
    }, [value])

    const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setLocalValue(newValue)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        onChange(newValue)
      }, 150)
    }, [onChange])

    useEffect(() => {
      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
        }
      }
    }, [])

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setLocalValue('')
        onChange('')
        onClose()
      }
    }, [onChange, onClose])

    const handleClear = useCallback(() => {
      setLocalValue('')
      onChange('')
      inputRef.current?.focus()
    }, [onChange])

    const showClear = localValue.length > 0
    const showCount = value.length > 0

    return (
      <div
        className="flex items-center rounded px-2 py-1"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
        }}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
        onClick={stopPropagation}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search commits..."
          className="bg-transparent outline-none placeholder:opacity-50 ml-2 flex-1 min-w-0"
          style={{
            color: 'var(--color-text-primary)',
            fontSize: theme.fontSize.body,
          }}
        />
        {showCount && (
          <span
            className="ml-2 whitespace-nowrap flex-shrink-0"
            style={{
              color: 'var(--color-text-muted)',
              fontSize: theme.fontSize.caption,
            }}
          >
            {matchCount}/{totalCount}
          </span>
        )}
        {showClear && (
          <button
            onClick={handleClear}
            className="ml-1 hover:opacity-80 flex-shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
            title="Clear search (Escape)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    )
  }
)
