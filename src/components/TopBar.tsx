import { VscHome, VscSettingsGear, VscLayoutSidebarRight, VscLayoutSidebarRightOff } from 'react-icons/vsc'
import { TabBar } from './TabBar'
import { ProjectTab } from '../common/projectTabs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRef, useEffect } from 'react'
import { OpenInSplitButton } from './OpenInSplitButton'
import { BranchIndicator } from './BranchIndicator'
import { logger } from '../utils/logger'
import { theme } from '../common/theme'
import { withOpacity } from '../common/colorUtils'
import { GithubMenuButton } from './github/GithubMenuButton'

interface TopBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onGoHome: () => void
  onSelectTab: (path: string) => void | Promise<void | boolean>
  onCloseTab: (path: string) => void | Promise<void>
  onOpenSettings: () => void
  isRightPanelCollapsed?: boolean
  onToggleRightPanel?: () => void
  // Optional custom resolver for Open button path (e.g., active session worktree)
  resolveOpenPath?: () => Promise<string | undefined>
}

export function TopBar({
  tabs,
  activeTabPath,
  onGoHome,
  onSelectTab,
  onCloseTab,
  onOpenSettings,
  isRightPanelCollapsed = false,
  onToggleRightPanel,
  resolveOpenPath
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
        logger.warn('Failed to start window dragging:', err)
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
      className="fixed top-0 left-0 right-0 h-[32px] bg-bg-primary z-50 select-none"
      style={{ 
        borderBottom: `1px solid ${withOpacity(theme.colors.background.elevated, 0.5)}`
      } as React.CSSProperties}
      data-tauri-drag-region
    >
      <div className="flex items-center h-full">
        {/* macOS traffic lights space - properly sized */}
        <div className="w-[70px] shrink-0" data-tauri-drag-region />
        
        {/* Home button */}
        <button
          onClick={onGoHome}
          className="h-full px-2 inline-flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/50 transition-colors"
          title="Home"
          aria-label="Home"
        >
          <VscHome className="text-[14px]" />
        </button>
        
        {tabs.length > 0 && (
          <div className="h-4 w-px bg-bg-elevated/50 mx-0.5" />
        )}
        
        {/* Tabs */}
        <div className="h-full overflow-x-auto scrollbar-hide" data-no-drag>
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
        
        {/* GitHub status/actions */}
        <GithubMenuButton className="mr-2" hasActiveProject={Boolean(activeTabPath)} />

        {/* Open in IDE button - only show when a tab is active */}
        {activeTabPath && (
          <div className="mr-2" data-testid="topbar-open-button">
            <OpenInSplitButton 
              resolvePath={resolveOpenPath ?? (async () => activeTabPath)}
            />
          </div>
        )}

        
        {/* Right panel collapse button - only show when a tab is active */}
        {activeTabPath && onToggleRightPanel && (
          <button
            onClick={onToggleRightPanel}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors mr-2"
            title={isRightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
            aria-label={isRightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
          >
            {isRightPanelCollapsed ? (
              <VscLayoutSidebarRightOff className="text-[14px]" />
            ) : (
              <VscLayoutSidebarRight className="text-[14px]" />
            )}
          </button>
        )}
        
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors mr-3"
          title="Settings"
          aria-label="Settings"
        >
          <VscSettingsGear className="text-[14px]" />
        </button>
      </div>
    </div>
  )
}
