import { useRef, forwardRef, useImperativeHandle, memo } from 'react'
import { Terminal, TerminalHandle } from './Terminal'
import { useTerminalTabs } from '../../hooks/useTerminalTabs'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus, safeTerminalFocusImmediate } from '../../utils/safeFocus'

interface TerminalTabsProps {
  baseTerminalId: string
  workingDirectory: string
  className?: string
  sessionName?: string
  isCommander?: boolean
  maxTabs?: number
  agentType?: string
  onTerminalClick?: () => void
  headless?: boolean
  bootstrapTopTerminalId?: string
}

export interface TerminalTabsHandle {
   focus: () => void
   focusTerminal: (terminalId: string) => void
   getTabsState: () => {
     tabs: TabInfo[]
     activeTab: number
     canAddTab: boolean
   }
   getTabFunctions: () => {
     addTab: () => void
     closeTab: (index: number) => void
     setActiveTab: (index: number) => void
   }
}

export interface TabInfo {
  index: number
  terminalId: string
  label: string
}

const TerminalTabsComponent = forwardRef<TerminalTabsHandle, TerminalTabsProps>(({
  baseTerminalId,
  workingDirectory,
  className = '',
  sessionName,
  isCommander = false,
  maxTabs = 6,
  agentType,
  onTerminalClick,
  headless = false,
  bootstrapTopTerminalId
}, ref) => {
  const { tabs, activeTab, canAddTab, addTab, closeTab, setActiveTab } = useTerminalTabs({
    baseTerminalId,
    workingDirectory,
    maxTabs,
    sessionName: sessionName ?? null,
    bootstrapTopTerminalId
  })

  const terminalRefs = useRef<Map<number, TerminalHandle>>(new Map())
  const { isAnyModalOpen } = useModal()

   useImperativeHandle(ref, () => ({
     focus: () => {
       // Since we only render the active terminal, it should be the only one in the refs
       const activeTerminalRef = terminalRefs.current.get(activeTab)
       if (activeTerminalRef) {
         safeTerminalFocusImmediate(() => activeTerminalRef.focus(), isAnyModalOpen)
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
              safeTerminalFocusImmediate(() => terminalRef.focus(), isAnyModalOpen)
            }
          })
       }
     },
     getTabsState: () => ({
       tabs,
       activeTab,
       canAddTab
     }),
     getTabFunctions: () => ({
       addTab,
       closeTab,
       setActiveTab
     })
   }), [activeTab, tabs, canAddTab, addTab, closeTab, setActiveTab, isAnyModalOpen])



  if (headless) {
    return (
      <div className={`h-full ${className}`}>
        <div className="h-full relative">
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
  }

  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div
        className="h-10 flex-shrink-0 flex items-stretch overflow-x-auto scrollbar-hide"
        style={{
          backgroundColor: theme.colors.background.primary,
          borderBottom: `1px solid ${theme.colors.border.subtle}`,
          boxShadow: `inset 0 -1px 0 ${theme.colors.border.default}`,
        }}
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
                  safeTerminalFocus(() => activeTerminalRef.focus(), isAnyModalOpen)
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
            className="flex items-center justify-center w-14 h-full"
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

TerminalTabsComponent.displayName = 'TerminalTabs';

export const TerminalTabs = memo(TerminalTabsComponent)

TerminalTabs.displayName = 'TerminalTabs'
