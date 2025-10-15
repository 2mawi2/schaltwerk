import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { theme } from '../../common/theme'
import { calculateDropdownGeometry, DropdownGeometry } from './dropdownGeometry'

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
  const [menuGeometry, setMenuGeometry] = useState<DropdownGeometry | null>(null)

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

  useLayoutEffect(() => {
    if (!open) {
      setMenuGeometry(null)
      return
    }

    const updateGeometry = () => {
      const container = containerRef.current
      if (!container) return

      const nextGeometry = calculateDropdownGeometry({
        anchorRect: container.getBoundingClientRect(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        alignment: align,
        minWidth
      })

      setMenuGeometry(nextGeometry)
    }

    updateGeometry()

    const handleScroll = () => updateGeometry()
    const handleResize = () => updateGeometry()

    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, align, minWidth])

  return (
    <div className="relative" ref={containerRef}>
      {children({ open, toggle: () => onOpenChange(!open) })}
      {open && menuGeometry && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: theme.layers.dropdownOverlay }}
            onClick={() => onOpenChange(false)}
          />
          <div
            data-testid={menuTestId}
            className="rounded shadow-lg overflow-auto"
            style={{
              position: 'fixed',
              top: menuGeometry.top,
              left: menuGeometry.left,
              width: menuGeometry.width,
              maxHeight: menuGeometry.maxHeight,
              zIndex: theme.layers.dropdownMenu,
              backgroundColor: theme.colors.background.elevated,
              border: `1px solid ${theme.colors.border.default}`,
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
        </>,
        document.body
      )}
    </div>
  )
}
