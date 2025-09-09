import { forwardRef } from 'react'
import { VscChevronDown, VscChevronUp } from 'react-icons/vsc'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'
import { 
    canCloseTab, 
    isRunTab,
    getRunButtonIcon,
    getRunButtonLabel,
    getRunButtonTooltip
} from './UnifiedBottomBar.logic'

export interface TabInfo {
  index: number
  terminalId: string
  label: string
}

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
  onConfigureRun?: () => void
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
  onRunScript,
  onConfigureRun: _onConfigureRun
}, ref) => {
  return (
    <div
      ref={ref}
      data-bottom-header
      className={`h-10 px-4 text-xs border-b cursor-pointer flex-shrink-0 flex items-center transition-colors duration-200 ${
        isFocused
          ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40'
          : 'text-slate-400 border-slate-800 hover:bg-slate-800'
      }`}
      onClick={onBarClick}
      style={{
        fontSize: theme.fontSize.body,
      }}
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
                className="flex items-center justify-center w-12 h-full transition-all duration-200 hover:scale-105 active:scale-95"
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
            className={`px-1.5 py-1 flex items-center gap-0.5 rounded transition-colors text-xs ${
              isRunning
                ? isFocused
                  ? 'bg-red-600/60 hover:bg-red-600/80 text-red-100'
                  : 'bg-red-700/50 hover:bg-red-700/70 text-red-200'
                : isFocused
                  ? 'bg-cyan-600/60 hover:bg-cyan-600/80 text-cyan-100'
                  : 'bg-cyan-700/50 hover:bg-cyan-700/70 text-cyan-200'
            }`}
          >
            <span className="text-[11px]">{getRunButtonIcon(isRunning)}</span>
            <span className="text-[11px] font-medium">{getRunButtonLabel(isRunning)}</span>
            <span className="text-[9px] opacity-60 ml-0.5">⌘E</span>
          </button>
        )}
        
        <span 
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors duration-200 ${
            isFocused
              ? 'bg-blue-600/40 text-blue-200'
              : 'bg-slate-700/50 text-slate-400'
          }`} 
          title="Focus Terminal (⌘/)"
        >
          ⌘/
        </span>
        
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
          title={isCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            isFocused
              ? 'hover:bg-blue-600/50 text-blue-200 hover:text-blue-100'
              : 'hover:bg-slate-700/50 text-slate-300 hover:text-slate-100'
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