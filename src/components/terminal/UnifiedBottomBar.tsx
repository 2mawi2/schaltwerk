import { forwardRef } from 'react'
import { VscChevronDown, VscChevronUp } from 'react-icons/vsc'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'

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
  onBarClick
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
            {tabs.map((tab) => (
              <UnifiedTab
                key={tab.index}
                id={tab.index}
                label={tab.label}
                isActive={tab.index === activeTab}
                onSelect={() => onTabSelect(tab.index)}
                onClose={tabs.length > 1 ? () => onTabClose(tab.index) : undefined}
                onMiddleClick={tabs.length > 1 ? () => onTabClose(tab.index) : undefined}
                showCloseButton={tabs.length > 1}
                className="h-full"
                style={{
                  maxWidth: '150px',
                  minWidth: '100px'
                }}
              />
            ))}
            
            {canAddTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabAdd()
                }}
                className="flex items-center justify-center w-14 h-full transition-all duration-300 ease-out hover:scale-105 active:scale-95"
                style={{
                  color: theme.colors.text.tertiary,
                  borderRight: `1px solid ${theme.colors.border.subtle}`,
                  borderTop: `3px solid transparent`,
                  fontSize: theme.fontSize.bodyLarge,
                  backgroundColor: 'transparent',
                  fontWeight: '600',
                  borderTopLeftRadius: theme.borderRadius.md,
                  borderTopRightRadius: theme.borderRadius.md,
                  paddingLeft: theme.spacing.md,
                  paddingRight: theme.spacing.md,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = theme.colors.accent.blue.light
                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.bg
                  e.currentTarget.style.borderTopColor = theme.colors.accent.blue.DEFAULT
                  e.currentTarget.style.boxShadow = `0 4px 12px ${theme.colors.accent.blue.bg}`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = theme.colors.text.tertiary
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.borderTopColor = 'transparent'
                  e.currentTarget.style.boxShadow = 'none'
                }}
                title="Add new terminal"
              >
                <span className="text-lg font-bold leading-none">+</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Right: Keyboard shortcut + Collapse button */}
      <div className="flex items-center ml-auto gap-1">
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