import { useCallback, useEffect, useState } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import Split from 'react-split'
import { TerminalGrid } from '../terminal/TerminalGrid'
import { SpecEditor } from './SpecEditor'
import { VscClose } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

interface Props {
  sessionName: string
  onExit: () => void
}

export function SpecModeLayout({ sessionName, onExit }: Props) {
  const [splitSizes, setSplitSizes] = useState<[number, number]>([60, 40])
  
  useEffect(() => {
    const savedSizes = localStorage.getItem('schaltwerk:spec-mode:split-sizes')
    if (savedSizes) {
      try {
        const parsed = JSON.parse(savedSizes)
        if (Array.isArray(parsed) && parsed.length === 2) {
          setSplitSizes(parsed as [number, number])
        }
      } catch (error) {
        logger.error('[SpecModeLayout] Failed to parse saved split sizes:', error)
      }
    }
  }, [])
  
  const handleSplitDragEnd = useCallback((newSizes: number[]) => {
    if (newSizes.length === 2) {
      setSplitSizes(newSizes as [number, number])
      localStorage.setItem('schaltwerk:spec-mode:split-sizes', JSON.stringify(newSizes))
    }
  }, [])
  
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])
  
  const handleStartSpec = useCallback(async () => {
    try {
      await invoke(TauriCommands.SchaltwerkCoreStartSpecSession, { name: sessionName })
      onExit()
    } catch (error) {
      logger.error('[SpecModeLayout] Failed to start spec:', error)
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
          <span 
            className="font-medium truncate"
            style={{ 
              fontSize: theme.fontSize.body,
              color: theme.colors.text.primary 
            }}
            title={sessionName}
          >
            {sessionName}
          </span>
        </div>
        <button
          onClick={onExit}
          className="flex items-center gap-1 px-2 py-1 rounded"
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
             <SpecEditor
               sessionName={sessionName}
               onStart={handleStartSpec}
             />
          </div>
        </Split>
      </div>
    </div>
  )
}
