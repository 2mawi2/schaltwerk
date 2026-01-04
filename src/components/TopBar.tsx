import {
  VscHome,
  VscSettingsGear,
  VscLayoutSidebarRight,
  VscLayoutSidebarRightOff
} from 'react-icons/vsc'
import { TabBar } from './TabBar'
import { ProjectTab } from '../common/projectTabs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRef, useEffect, useCallback, useState } from 'react'
import { OpenInSplitButton } from './OpenInSplitButton'
import { BranchIndicator } from './BranchIndicator'
import { logger } from '../utils/logger'
import { GithubMenuButton } from './github/GithubMenuButton'
import { WindowControls } from './WindowControls'
import { getPlatform } from '../utils/platform'
import { detectPlatformSafe } from '../keyboardShortcuts/helpers'
import { GlobalKeepAwakeButton } from './GlobalKeepAwakeButton'

type UiPlatform = 'mac' | 'linux' | 'windows'

const normalizePlatform = (value?: string | null): UiPlatform => {
  if (!value) return 'mac'
  const lowered = value.toLowerCase()
  if (lowered.startsWith('mac')) return 'mac'
  if (lowered.startsWith('win')) return 'windows'
  if (lowered.startsWith('linux')) return 'linux'
  return 'mac'
}

interface TopBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onGoHome: () => void
  onSelectTab: (path: string) => void | Promise<void | boolean>
  onCloseTab: (path: string) => void | Promise<void>
  onOpenSettings: () => void
  onOpenProjectSelector?: () => void
  isRightPanelCollapsed?: boolean
  onToggleRightPanel?: () => void
  // Optional custom resolver for Open button path (e.g., active session worktree)
  resolveOpenPath?: () => Promise<string | undefined>
  // Counter to trigger open from keyboard shortcut
  triggerOpenCounter?: number
}

export function TopBar({
  tabs,
  activeTabPath,
  onGoHome,
  onSelectTab,
  onCloseTab,
  onOpenSettings,
  onOpenProjectSelector,
  isRightPanelCollapsed = false,
  onToggleRightPanel,
  resolveOpenPath,
  triggerOpenCounter
}: TopBarProps) {
  const dragAreaRef = useRef<HTMLDivElement>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  const openButtonRef = useRef<{ triggerOpen: () => Promise<void> } | null>(null)
  const [platform, setPlatform] = useState<UiPlatform>(() => normalizePlatform(detectPlatformSafe()))
  const isMac = platform === 'mac'
  useEffect(() => {
    let cancelled = false
    void getPlatform()
      .then(value => {
        if (!cancelled) {
          setPlatform(normalizePlatform(value))
        }
      })
      .catch(error => {
        logger.debug('Failed to determine precise platform via plugin_os', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenReady = useCallback((handler: () => Promise<void>) => {
    openButtonRef.current = { triggerOpen: handler }
  }, [])

  useEffect(() => {
    if (triggerOpenCounter && triggerOpenCounter > 0 && openButtonRef.current) {
      openButtonRef.current.triggerOpen().catch(err => {
        logger.error('Failed to open in app from keyboard shortcut', err)
      })
    }
  }, [triggerOpenCounter])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Check if the click is on the drag area or the top bar itself (not buttons)
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('[data-no-drag]')) {
        return
      }
      
      getCurrentWindow().startDragging().catch((err) => {
        logger.warn('Failed to start window dragging:', err)
      })
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
      className="fixed top-0 left-0 right-0 h-[32px] bg-bg-tertiary z-50 select-none"
      style={{ 
        borderBottom: '1px solid rgba(var(--color-bg-elevated-rgb), 0.5)'
      } as React.CSSProperties}
      data-tauri-drag-region
    >
      <div className="flex items-center h-full">
        {/* macOS traffic lights space - properly sized */}
        {isMac && <div className="w-[70px] shrink-0" data-tauri-drag-region />}
        
        {/* Home button */}
        <button
          onClick={onGoHome}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors ml-2 cursor-pointer relative z-10"
          title="Home"
          aria-label="Home"
          data-no-drag
          style={{ pointerEvents: 'auto' } as React.CSSProperties}
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
            onOpenProjectSelector={onOpenProjectSelector}
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
          <div
            className="mr-2"
            data-testid="topbar-open-button"
            data-onboarding="open-worktree-button"
          >
            <OpenInSplitButton
              resolvePath={resolveOpenPath ?? (async () => ({ worktreeRoot: activeTabPath }))}
              onOpenReady={handleOpenReady}
            />
          </div>
        )}

        {/* GitHub status/actions */}
        <GithubMenuButton className="mr-2" hasActiveProject={Boolean(activeTabPath)} />

        {/* Global keep-awake toggle */}
        <div className="mr-2" data-no-drag>
          <GlobalKeepAwakeButton />
        </div>

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
          className="h-6 w-6 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors mr-2"
          title="Settings"
          aria-label="Settings"
        >
          <VscSettingsGear className="text-[14px]" />
        </button>

        {/* Window controls for non-macOS */}
        {!isMac && <WindowControls />}
      </div>
    </div>
  )
}
