import { VscHome, VscSettingsGear, VscListFlat } from 'react-icons/vsc'
import { TabBar, ProjectTab } from './TabBar'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRef, useEffect } from 'react'
import { OpenInSplitButton } from './OpenInSplitButton'
import { BranchIndicator } from './BranchIndicator'

interface TopBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onGoHome: () => void
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onOpenSettings: () => void
  onOpenKanban?: () => void
}

export function TopBar({
  tabs,
  activeTabPath,
  onGoHome,
  onSelectTab,
  onCloseTab,
  onOpenSettings,
  onOpenKanban
}: TopBarProps) {
  const dragAreaRef = useRef<HTMLDivElement>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const handleMouseDown = async (e: MouseEvent) => {
      // Check if the click is on the drag area or the top bar itself (not buttons)
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('[data-no-drag]')) {
        return
      }
      
      try {
        await getCurrentWindow().startDragging()
      } catch (err) {
        console.error('Failed to start dragging:', err)
      }
    }
    
    // Add listeners to both the drag area and the top bar
    const dragArea = dragAreaRef.current
    const topBar = topBarRef.current
    
    if (dragArea) {
      dragArea.addEventListener('mousedown', handleMouseDown)
    }
    if (topBar) {
      topBar.addEventListener('mousedown', handleMouseDown)
    }
    
    return () => {
      if (dragArea) {
        dragArea.removeEventListener('mousedown', handleMouseDown)
      }
      if (topBar) {
        topBar.removeEventListener('mousedown', handleMouseDown)
      }
    }
  }, [])
  
  return (
    <div 
      ref={topBarRef}
      className="fixed top-0 left-0 right-0 h-[32px] bg-slate-950 z-50 select-none"
      style={{ 
        borderBottom: '1px solid rgba(30, 41, 59, 0.5)'
      } as React.CSSProperties}
      data-tauri-drag-region
    >
      <div className="flex items-center h-full">
        {/* macOS traffic lights space - properly sized */}
        <div className="w-[70px] shrink-0" data-tauri-drag-region />
        
        {/* Home button */}
        <button
          onClick={onGoHome}
          className="h-full px-2 inline-flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 transition-colors"
          title="Home"
          aria-label="Home"
        >
          <VscHome className="text-[14px]" />
        </button>
        
        {tabs.length > 0 && (
          <div className="h-4 w-px bg-slate-800/50 mx-0.5" />
        )}
        
        {/* Tabs */}
        <div data-no-drag>
          <TabBar
            tabs={tabs}
            activeTabPath={activeTabPath}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
          />
        </div>
        
        {/* Spacer in the middle - MAIN draggable area */}
        <div 
          ref={dragAreaRef}
          className="flex-1 h-full cursor-default"
          data-tauri-drag-region
          style={{ 
            WebkitUserSelect: 'none',
            userSelect: 'none'
          } as React.CSSProperties}
        />
        
        {/* Branch indicator - only shows in development builds */}
        <BranchIndicator />
        
        {/* Open in IDE button - only show when a tab is active */}
        {activeTabPath && (
          <div className="mr-2">
            <OpenInSplitButton 
              resolvePath={async () => activeTabPath}
            />
          </div>
        )}
        
        {/* Agent Board button - only show when a project is open */}
        {activeTabPath && onOpenKanban && (
          <button
            onClick={onOpenKanban}
            className="h-6 px-2 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors mr-2 text-xs gap-1"
            title="Agent Board (⌘⇧K)"
            aria-label="Agent Board"
          >
            <VscListFlat className="text-[14px]" />
            <span>Board</span>
          </button>
        )}
        
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors mr-3"
          title="Settings"
          aria-label="Settings"
        >
          <VscSettingsGear className="text-[14px]" />
        </button>
      </div>
    </div>
  )
}