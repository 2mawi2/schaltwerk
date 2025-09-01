import { useEffect, useState, useMemo } from 'react'
import { VscChevronDown, VscAdd } from 'react-icons/vsc'
import { useSessions } from '../../contexts/SessionsContext'
import { theme } from '../../common/theme'

interface Props {
  sessionName: string
  onSwitchSpec: (newSpecName: string) => void
}

export function SpecDropdown({ sessionName, onSwitchSpec }: Props) {
  const { sessions } = useSessions()
  const [showSpecDropdown, setShowSpecDropdown] = useState(false)
  
  // Get available specs with stable sort to prevent unnecessary re-renders
  const specs = useMemo(() => {
    const specSessions = sessions.filter(session => 
      session.info.status === 'spec' || session.info.session_state === 'spec'
    )
    
    // Sort by name to maintain consistent order regardless of backend sorting changes
    // This prevents the dropdown from jumping around when sessions are refreshed
    return specSessions
      .map(session => ({
        name: session.info.session_id,
        created_at: session.info.created_at || ''
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [sessions])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.spec-dropdown-container')) {
        setShowSpecDropdown(false)
      }
    }

    if (showSpecDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSpecDropdown])

  // Close dropdown on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSpecDropdown) {
        setShowSpecDropdown(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSpecDropdown])

  return (
    <div className="relative spec-dropdown-container">
      <button
        onClick={() => setShowSpecDropdown(!showSpecDropdown)}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-opacity-10"
        style={{
          fontSize: theme.fontSize.body,
          color: theme.colors.text.primary,
          backgroundColor: showSpecDropdown ? theme.colors.background.hover : 'transparent'
        }}
      >
        <span className="font-medium">{sessionName}</span>
        <VscChevronDown className="text-xs" />
        {specs.length > 1 && (
          <span className="text-xs opacity-60">({specs.length})</span>
        )}
      </button>
      
      {showSpecDropdown && (
        <div
          className="absolute top-full left-0 mt-1 py-1 rounded shadow-lg border min-w-[200px] max-h-[300px] overflow-auto z-50"
          style={{
            backgroundColor: theme.colors.background.elevated,
            borderColor: theme.colors.border.default
          }}
        >
          {specs.map((spec) => (
            <button
              key={spec.name}
              onClick={() => {
                onSwitchSpec(spec.name)
                setShowSpecDropdown(false)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-opacity-10 flex items-center justify-between group"
              style={{
                fontSize: theme.fontSize.body,
                color: spec.name === sessionName ? theme.colors.accent.blue.DEFAULT : theme.colors.text.primary,
                backgroundColor: spec.name === sessionName ? theme.colors.accent.blue.bg : 'transparent'
              }}
            >
              <span className="truncate">{spec.name}</span>
              {spec.name === sessionName && (
                <span className="text-xs opacity-60">Current</span>
              )}
            </button>
          ))}
          <div className="border-t my-1" style={{ borderColor: theme.colors.border.subtle }} />
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
              setShowSpecDropdown(false)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-opacity-10 flex items-center gap-2"
            style={{
              fontSize: theme.fontSize.body,
              color: theme.colors.text.secondary
            }}
          >
            <VscAdd className="text-sm" />
            <span>Create New Spec</span>
          </button>
        </div>
      )}
    </div>
  )
}