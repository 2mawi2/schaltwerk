import { useRef, forwardRef, useImperativeHandle } from 'react'
import { Terminal, TerminalHandle } from './Terminal'
import { useTerminalTabs } from '../../hooks/useTerminalTabs'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'

interface TerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  className?: string
  sessionName?: string
  isCommander?: boolean
  maxTabs?: number
  agentType?: string
  onTerminalClick?: () => void
}

export interface TerminalTabsHandle {
   focus: () => void
   focusTerminal: (terminalId: string) => void
}

export const TerminalTabs = forwardRef<TerminalTabsHandle, TerminalTabsProps>(({
  baseTerminalId,
  workingDirectory,
  className = '',
  sessionName,
  isCommander = false,
  maxTabs = 6,
  agentType,
  onTerminalClick
}, ref) => {
  const { tabs, activeTab, canAddTab, addTab, closeTab, setActiveTab } = useTerminalTabs({
    baseTerminalId,
    workingDirectory,
    maxTabs
  })

  const terminalRefs = useRef<Map<number, TerminalHandle>>(new Map())

   useImperativeHandle(ref, () => ({
     focus: () => {
       // Since we only render the active terminal, it should be the only one in the refs
       const activeTerminalRef = terminalRefs.current.get(activeTab)
       if (activeTerminalRef) {
         activeTerminalRef.focus()
       }
     },
     focusTerminal: (terminalId: string) => {
       // Find the tab with the matching terminal ID and focus it
       const targetTab = tabs.find(tab => tab.terminalId === terminalId)
       if (targetTab) {
         setActiveTab(targetTab.index)
          requestAnimationFrame(() => {
            const terminalRef = terminalRefs.current.get(targetTab.index)
            if (terminalRef) {
              terminalRef.focus()
            }
          })
       }
     }
   }), [activeTab, tabs])



  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div
        className="h-8 flex-shrink-0 flex items-stretch overflow-x-auto scrollbar-hide"
        style={{ backgroundColor: theme.colors.background.primary }}
      >
        {tabs.map((tab) => (
          <UnifiedTab
            key={tab.index}
            id={tab.index}
            label={tab.label}
            isActive={tab.index === activeTab}
            onSelect={() => {
              setActiveTab(tab.index)
              requestAnimationFrame(() => {
                const activeTerminalRef = terminalRefs.current.get(tab.index)
                if (activeTerminalRef) {
                  activeTerminalRef.focus()
                }
              })
            }}
            onClose={tabs.length > 1 ? () => closeTab(tab.index) : undefined}
            onMiddleClick={tabs.length > 1 ? () => closeTab(tab.index) : undefined}
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
            onClick={addTab}
            className="flex items-center justify-center w-12 h-full transition-all duration-200"
            style={{
              color: theme.colors.text.tertiary,
              borderRight: `1px solid ${theme.colors.border.default}`,
              borderTop: `2px solid transparent`,
              fontSize: theme.fontSize.body,
              backgroundColor: theme.colors.background.secondary
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = theme.colors.text.primary
              e.currentTarget.style.backgroundColor = theme.colors.background.hover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = theme.colors.text.tertiary
              e.currentTarget.style.backgroundColor = theme.colors.background.secondary
            }}
            title="Add new terminal"
          >
            +
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {tabs.filter(tab => tab.index === activeTab).map((tab) => (
          <div
            key={tab.index}
            className="absolute inset-0"
          >
            <Terminal
              ref={(ref) => {
                if (ref) {
                  terminalRefs.current.set(tab.index, ref)
                } else {
                  terminalRefs.current.delete(tab.index)
                }
              }}
              terminalId={tab.terminalId}
              className="h-full w-full"
              sessionName={sessionName}
              isCommander={isCommander}
              agentType={agentType}
              onTerminalClick={onTerminalClick}
            />
          </div>
        ))}
      </div>
    </div>
  )
})

TerminalTabs.displayName = 'TerminalTabs'