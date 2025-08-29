import { useCallback, useEffect, useState, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Split from 'react-split'
import { TerminalGrid } from '../terminal/TerminalGrid'
import { PlanEditor } from './PlanEditor'
import { VscClose, VscChevronDown, VscAdd } from 'react-icons/vsc'
import { useSessions } from '../../contexts/SessionsContext'
import { theme } from '../../common/theme'

interface Props {
  sessionName: string
  onExit: () => void
  onSwitchSpec: (newSpecName: string) => void
}

export function PlanModeLayout({ sessionName, onExit, onSwitchSpec }: Props) {
  const { sessions } = useSessions()
  const [splitSizes, setSplitSizes] = useState<[number, number]>([60, 40])
  const [showPlanDropdown, setShowPlanDropdown] = useState(false)
  
  useEffect(() => {
    const savedSizes = localStorage.getItem('schaltwerk:spec-mode:split-sizes')
    if (savedSizes) {
      try {
        const parsed = JSON.parse(savedSizes)
        if (Array.isArray(parsed) && parsed.length === 2) {
          setSplitSizes(parsed as [number, number])
        }
      } catch (error) {
        console.error('[PlanModeLayout] Failed to parse saved split sizes:', error)
      }
    }
  }, [])
  
  const handleSplitDragEnd = useCallback((newSizes: number[]) => {
    if (newSizes.length === 2) {
      setSplitSizes(newSizes as [number, number])
      localStorage.setItem('schaltwerk:spec-mode:split-sizes', JSON.stringify(newSizes))
    }
  }, [])
  
  // Get available plans
  const plans = useMemo(() => {
    return sessions.filter(session => 
      session.info.status === 'spec' || session.info.session_state === 'spec'
    ).map(session => ({
      name: session.info.session_id,
      created_at: session.info.created_at || ''
    }))
  }, [sessions])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPlanDropdown) {
          setShowPlanDropdown(false)
        } else {
          e.preventDefault()
          onExit()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, showPlanDropdown])
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.spec-dropdown-container')) {
        setShowPlanDropdown(false)
      }
    }

    if (showPlanDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPlanDropdown])
  
  const handleStartPlan = useCallback(async () => {
    try {
      await invoke('schaltwerk_core_start_spec_session', { name: sessionName })
      onExit()
    } catch (error) {
      console.error('[PlanModeLayout] Failed to start spec:', error)
    }
  }, [sessionName, onExit])
  
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: theme.colors.background.primary }}>
      <div 
        className="h-10 flex items-center justify-between px-4 border-b"
        style={{ 
          backgroundColor: theme.colors.background.secondary,
          borderColor: theme.colors.border.default 
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded" style={{ 
            backgroundColor: theme.colors.accent.amber.bg,
            color: theme.colors.accent.amber.DEFAULT,
            borderColor: theme.colors.accent.amber.border 
          }}>
             Spec Mode
          </span>
           <div className="relative spec-dropdown-container">
             <button
               onClick={() => setShowPlanDropdown(!showPlanDropdown)}
               className="flex items-center gap-1 px-2 py-1 rounded hover:bg-opacity-10"
               style={{
                 fontSize: theme.fontSize.body,
                 color: theme.colors.text.primary,
                 backgroundColor: showPlanDropdown ? theme.colors.background.hover : 'transparent'
               }}
             >
               <span className="font-medium">{sessionName}</span>
               <VscChevronDown className="text-xs" />
               {plans.length > 1 && (
                 <span className="text-xs opacity-60">({plans.length})</span>
               )}
            </button>
            
             {showPlanDropdown && (
               <div
                 className="absolute top-full left-0 mt-1 py-1 rounded shadow-lg border min-w-[200px] max-h-[300px] overflow-auto z-50"
                 style={{
                   backgroundColor: theme.colors.background.elevated,
                   borderColor: theme.colors.border.default
                 }}
               >
                 {plans.map((plan) => (
                   <button
                     key={plan.name}
                     onClick={() => {
                       onSwitchSpec(plan.name)
                       setShowPlanDropdown(false)
                     }}
                     className="w-full text-left px-3 py-1.5 hover:bg-opacity-10 flex items-center justify-between group"
                     style={{
                       fontSize: theme.fontSize.body,
                       color: plan.name === sessionName ? theme.colors.accent.blue.DEFAULT : theme.colors.text.primary,
                       backgroundColor: plan.name === sessionName ? theme.colors.accent.blue.bg : 'transparent'
                     }}
                   >
                     <span className="truncate">{plan.name}</span>
                     {plan.name === sessionName && (
                       <span className="text-xs opacity-60">Current</span>
                     )}
                   </button>
                 ))}
                <div className="border-t my-1" style={{ borderColor: theme.colors.border.subtle }} />
                 <button
                   onClick={() => {
                     window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
                     setShowPlanDropdown(false)
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
        </div>
        <button
          onClick={onExit}
          className="flex items-center gap-1 px-2 py-1 rounded transition-colors"
          style={{ 
            fontSize: theme.fontSize.button,
            color: theme.colors.text.secondary
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.background.hover
            e.currentTarget.style.color = theme.colors.text.primary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = theme.colors.text.secondary
          }}
           title="Exit Spec Mode (Esc)"
         >
           <VscClose />
           Exit Spec Mode
        </button>
      </div>
      
      <div className="flex-1 overflow-hidden">
        <Split
          className="split-horizontal h-full flex"
          sizes={splitSizes}
          minSize={300}
          gutterSize={4}
          onDragEnd={handleSplitDragEnd}
          direction="horizontal"
        >
          <div className="overflow-hidden">
            <TerminalGrid />
          </div>
          
          <div 
            className="overflow-hidden"
            style={{ backgroundColor: theme.colors.background.secondary }}
          >
             <PlanEditor
               sessionName={sessionName}
               onStart={handleStartPlan}
             />
          </div>
        </Split>
      </div>
    </div>
  )
}