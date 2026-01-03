import { forwardRef } from 'react'
import { VscChevronDown, VscChevronUp } from 'react-icons/vsc'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'
import { TabInfo } from '../../types/terminalTabs'
import {
    canCloseTab,
    isRunTab,
    getRunButtonIcon,
    getRunButtonLabel,
    getRunButtonTooltip
} from './UnifiedBottomBar.logic'
import { useMultipleShortcutDisplays } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { AddTabButton } from '../AddTabButton'

export interface UnifiedBottomBarProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  tabs: TabInfo[]
  activeTab: number
  onTabSelect: (index: number) => void
  onTabClose: (index: number) => void
  onTabAdd: () => void
  canAddTab: boolean
  isFocused: boolean
  onBarClick: () => void
  // Run Mode props
  hasRunScripts?: boolean
  isRunning?: boolean
  onRunScript?: () => void
}

export const UnifiedBottomBar = forwardRef<HTMLDivElement, UnifiedBottomBarProps>(({
  isCollapsed,
  onToggleCollapse,
  tabs,
  activeTab,
  onTabSelect,
  onTabClose,
  onTabAdd,
  canAddTab,
  isFocused,
  onBarClick,
  hasRunScripts = false,
  isRunning = false,
  onRunScript
}, ref) => {
  // Get dynamic shortcut displays
  const shortcuts = useMultipleShortcutDisplays([
    KeyboardShortcutAction.FocusTerminal,
    KeyboardShortcutAction.ToggleRunMode
  ])
  const runButtonColors = isRunning
    ? {
        background: isFocused ? 'var(--color-accent-red-bg)' : 'var(--color-accent-red)',
        text: isFocused ? 'var(--color-accent-red-light)' : 'var(--color-text-inverse)',
      }
    : {
        background: isFocused ? 'var(--color-accent-blue-dark)' : 'var(--color-accent-blue)',
        text: isFocused ? 'var(--color-accent-blue-light)' : 'var(--color-text-inverse)',
      };

  return (
    <div
      ref={ref}
      data-bottom-header
      style={{
        backgroundColor: isFocused ? 'var(--color-accent-blue-bg)' : undefined,
        color: isFocused ? 'var(--color-accent-blue-light)' : 'var(--color-text-tertiary)',
        borderBottomColor: isFocused ? 'var(--color-accent-blue-border)' : 'var(--color-border-default)',
        fontSize: theme.fontSize.body,
      }}
      className={`h-10 px-4 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${
        isFocused
          ? 'hover:bg-opacity-60'
          : 'hover:bg-elevated'
      }`}
      onClick={onBarClick}
    >
      {/* Left: Terminal tabs - only show when not collapsed */}
      {!isCollapsed && (
        <div className="flex items-center flex-1 min-w-0 h-full">
          <div className="flex items-center h-full overflow-x-auto overflow-y-hidden scrollbar-hide">
            {tabs.map((tab) => {
              const runTab = isRunTab(tab)
              const canClose = canCloseTab(tab, tabs)
              
              return (
                <UnifiedTab
                  key={tab.index}
                  id={tab.index}
                  label={tab.label}
                  isActive={tab.index === activeTab}
                  onSelect={() => onTabSelect(tab.index)}
                  onClose={canClose ? () => onTabClose(tab.index) : undefined}
                  onMiddleClick={canClose ? () => onTabClose(tab.index) : undefined}
                  showCloseButton={canClose}
                  className="h-full flex-shrink-0"
                  style={{
                    maxWidth: runTab ? '70px' : '150px',
                    minWidth: runTab ? '60px' : '100px'
                  }}
                  isRunTab={runTab}
                  isRunning={runTab && isRunning}
                />
              )
            })}
            
            {canAddTab && (
              <AddTabButton
                onClick={(event) => {
                  event.stopPropagation()
                  onTabAdd()
                }}
                title="Add new terminal"
                ariaLabel="Add new terminal"
                className="self-center ml-2 flex-shrink-0"
              />
            )}
          </div>
        </div>
      )}

      {/* Right: Run button + Keyboard shortcut + Collapse button */}
      <div className="flex items-center ml-auto gap-1">
        {/* Run/Stop Button */}
        {hasRunScripts && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRunScript?.()
            }}
            title={getRunButtonTooltip(isRunning)}
            style={{
              backgroundColor: runButtonColors.background,
              color: runButtonColors.text,
            }}
            className={`px-1.5 py-1 flex items-center gap-0.5 rounded text-xs ${
              isRunning
                ? isFocused
                  ? 'hover:opacity-80'
                  : 'hover:opacity-70'
                : isFocused
                  ? 'hover:opacity-80'
                  : 'hover:opacity-70'
            }`}
          >
            <span className="text-[11px]">{getRunButtonIcon(isRunning)}</span>
            <span className="text-[11px] font-medium">{getRunButtonLabel(isRunning)}</span>
            <span className="text-[9px] opacity-60 ml-0.5">
              {shortcuts[KeyboardShortcutAction.ToggleRunMode] || '⌘E'}
            </span>
          </button>
        )}
        
        <span
          style={{
            backgroundColor: isFocused ? 'var(--color-accent-blue-bg)' : 'var(--color-bg-hover)',
            color: isFocused ? 'var(--color-accent-blue-light)' : 'var(--color-text-tertiary)',
          }}
          className="text-[10px] px-1.5 py-0.5 rounded"
          title={`Focus Terminal (${shortcuts[KeyboardShortcutAction.FocusTerminal] || '⌘/'})`}
        >
          {shortcuts[KeyboardShortcutAction.FocusTerminal] || '⌘/'}

        </span>
        
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
          title={isCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
          style={{
            color: isFocused ? 'var(--color-accent-blue-light)' : 'var(--color-text-secondary)',
          }}
          className={`w-7 h-7 flex items-center justify-center rounded ${
            isFocused
              ? 'hover:bg-opacity-60 hover:text-white'
              : 'hover:bg-hover hover:text-primary'
          }`}
          aria-label={isCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
        >
          {isCollapsed ? (
            <VscChevronUp size={16} />
          ) : (
            <VscChevronDown size={16} />
          )}
        </button>
      </div>
    </div>
  )
})

UnifiedBottomBar.displayName = 'UnifiedBottomBar'
