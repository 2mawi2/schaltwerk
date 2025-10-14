import { useState, useEffect, useRef, useMemo } from 'react'
import { theme } from '../../common/theme'
import { EnrichedSession } from '../../types/session'
import { VscSearch, VscClose } from 'react-icons/vsc'

interface Props {
  specs: EnrichedSession[]
  onSelect: (specId: string) => void
  onClose: () => void
}

export function SpecPickerOverlay({ specs, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return specs

    return specs.filter(spec => {
      const name = spec.info.display_name || spec.info.session_id
      const content = spec.info.spec_content || ''
      return name.toLowerCase().includes(q) || content.toLowerCase().includes(q)
    })
  }, [specs, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-spec-picker-overlay]')) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].info.session_id)
        }
        break
    }
  }

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  return (
    <div
      className="absolute inset-0 flex items-start justify-center pt-16 px-8 z-50"
      style={{ backgroundColor: theme.colors.overlay.backdrop }}
    >
      <div
        data-spec-picker-overlay
        className="w-full max-w-2xl rounded-lg border-2"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderColor: theme.colors.border.subtle,
          boxShadow: theme.shadow.xl
        }}
        onKeyDown={handleKeyDown}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b-2"
          style={{ borderColor: theme.colors.border.subtle }}
        >
          <VscSearch style={{ color: theme.colors.text.tertiary, fontSize: theme.fontSize.bodyLarge }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search specs..."
            className="flex-1 bg-transparent border-none outline-none placeholder:text-slate-500"
            style={{
              color: theme.colors.text.primary,
              fontSize: theme.fontSize.body
            }}
          />
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{
              color: theme.colors.text.tertiary,
              backgroundColor: 'transparent'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.colors.background.hover}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="Close (Esc)"
          >
            <VscClose />
          </button>
        </div>

        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
          style={{ backgroundColor: theme.colors.background.secondary }}
        >
          {filtered.length === 0 ? (
            <div
              className="px-4 py-8 text-center"
              style={{
                color: theme.colors.text.tertiary,
                fontSize: theme.fontSize.body
              }}
            >
              {query ? 'No specs match your search' : 'No specs available'}
            </div>
          ) : (
            filtered.map((spec, index) => {
              const displayName = spec.info.display_name || spec.info.session_id
              const isSelected = index === selectedIndex

              return (
                <button
                  key={spec.info.session_id}
                  onClick={() => onSelect(spec.info.session_id)}
                  className="w-full px-4 py-3 text-left transition-colors border-b last:border-b-0"
                  style={{
                    backgroundColor: isSelected
                      ? theme.colors.background.elevated
                      : 'transparent',
                    borderColor: theme.colors.border.default,
                    color: theme.colors.text.primary,
                    fontSize: theme.fontSize.body
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="font-medium" style={{
                    color: isSelected ? theme.colors.accent.cyan.DEFAULT : theme.colors.text.primary,
                    fontSize: theme.fontSize.body
                  }}>
                    {displayName}
                  </div>
                  {spec.info.spec_content && (
                    <div
                      className="mt-1 truncate"
                      style={{
                        color: theme.colors.text.tertiary,
                        fontSize: theme.fontSize.caption
                      }}
                    >
                      {spec.info.spec_content.slice(0, 100)}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
