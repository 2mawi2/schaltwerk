import React, { useEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../../common/theme'

export interface DropdownItem {
  key: string
  label: React.ReactNode
  disabled?: boolean
  title?: string
}

interface DropdownProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: DropdownItem[]
  selectedKey?: string
  onSelect: (key: string) => void
  align?: 'left' | 'right' | 'stretch'
  children: (args: { open: boolean; toggle: () => void }) => React.ReactNode
  menuTestId?: string
  minWidth?: number
}

export function Dropdown({ open, onOpenChange, items, selectedKey, onSelect, align = 'right', children, menuTestId, minWidth = 180 }: DropdownProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const selectedIndex = useMemo(() => items.findIndex(i => i.key === selectedKey), [items, selectedKey])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0)
    } else {
      setFocusedIndex(-1)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          setFocusedIndex(prev => {
            const next = prev + 1
            const max = items.length - 1
            return next > max ? 0 : next
          })
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          setFocusedIndex(prev => {
            const next = prev - 1
            const max = items.length - 1
            return next < 0 ? max : next
          })
          break
        }
        case 'Enter': {
          e.preventDefault()
          const item = items[focusedIndex]
          if (item && !item.disabled) {
            onSelect(item.key)
            onOpenChange(false)
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          onOpenChange(false)
          break
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, focusedIndex, items, onSelect, onOpenChange])

  return (
    <div className="relative" ref={containerRef}>
      {children({ open, toggle: () => onOpenChange(!open) })}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div
            data-testid={menuTestId}
            className={`absolute mt-1 z-50 rounded shadow-lg overflow-hidden ${align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-0 right-0'}`}
            style={{
              backgroundColor: theme.colors.background.elevated,
              border: `1px solid ${theme.colors.border.default}`,
              minWidth
            }}
          >
            {items.map((item, index) => {
              const isFocused = index === focusedIndex
              const isSelected = item.key === selectedKey
              const canSelect = !item.disabled
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => { if (canSelect) { onSelect(item.key); onOpenChange(false) } }}
                  disabled={!canSelect}
                  className={`block w-full text-left px-3 py-1.5 ${canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} ${isFocused ? 'opacity-90' : isSelected ? 'opacity-90' : canSelect ? 'hover:opacity-80' : ''}`}
                  style={{
                    color: canSelect ? theme.colors.text.primary : theme.colors.text.muted,
                    backgroundColor: isFocused ? theme.colors.background.hover : isSelected ? theme.colors.background.active : 'transparent'
                  }}
                  title={typeof item.label === 'string' ? (item.label as string) : item.title}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

