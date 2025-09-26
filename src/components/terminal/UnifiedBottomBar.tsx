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
        background: isFocused ? theme.colors.accent.red.bg : theme.colors.accent.red.DEFAULT,
        text: isFocused ? theme.colors.accent.red.light : theme.colors.text.inverse,
      }
    : {
        background: isFocused ? theme.colors.accent.blue.dark : theme.colors.accent.blue.DEFAULT,
        text: isFocused ? theme.colors.accent.blue.light : theme.colors.text.inverse,
      };

  return (
    <div
      ref={ref}
      data-bottom-header
      style={{
        backgroundColor: isFocused ? theme.colors.accent.blue.bg : undefined,
        color: isFocused ? theme.colors.accent.blue.light : undefined,
        borderBottomColor: isFocused ? theme.colors.accent.blue.border : undefined,
        fontSize: theme.fontSize.body,
      }}
      className={`h-10 px-4 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${
        isFocused
          ? 'hover:bg-opacity-60'
          : 'text-slate-400 border-slate-800 hover:bg-slate-800'
      }`}
      onClick={onBarClick}
    >
      {/* Left: Terminal tabs - only show when not collapsed */}
      {!isCollapsed && (
        <div className="flex items-stretch flex-1 min-w-0">
          <div className="flex items-stretch overflow-x-auto scrollbar-hide">
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
                  className="h-full"
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
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabAdd()
                }}
                className="flex items-center justify-center w-12 h-full"
                style={{
                  color: theme.colors.text.tertiary,
                  borderRight: `1px solid ${theme.colors.border.subtle}`,
                  borderTop: `3px solid transparent`,
                  fontSize: '16px',
                  backgroundColor: 'transparent',
                  fontWeight: '600',
                  paddingLeft: '0',
                  paddingRight: '0',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = theme.colors.accent.blue.light
                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.bg
                  e.currentTarget.style.borderTopColor = theme.colors.accent.blue.DEFAULT
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = theme.colors.text.tertiary
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.borderTopColor = 'transparent'
                }}
                title="Add new terminal"
              >
                <span className="text-base font-bold leading-none">+</span>
              </button>
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
            backgroundColor: isFocused ? theme.colors.accent.blue.bg : theme.colors.background.hover,
            color: isFocused ? theme.colors.accent.blue.light : theme.colors.text.tertiary,
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
            color: isFocused ? theme.colors.accent.blue.light : theme.colors.text.secondary,
          }}
          className={`w-7 h-7 flex items-center justify-center rounded ${
            isFocused
              ? 'hover:bg-opacity-60 hover:text-white'
              : 'hover:bg-slate-700/50 hover:text-slate-100'
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
