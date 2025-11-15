import { useRef, forwardRef, useImperativeHandle, memo } from 'react'
import { Terminal, TerminalHandle } from './Terminal'
import { useTerminalTabs } from '../../hooks/useTerminalTabs'
import { UnifiedTab } from '../UnifiedTab'
import { theme } from '../../common/theme'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus, safeTerminalFocusImmediate } from '../../utils/safeFocus'
import { TabInfo } from '../../types/terminalTabs'
import { AddTerminalButton } from './AddTerminalButton'

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
   getActiveTerminalRef: () => TerminalHandle | null
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
     }),
     getActiveTerminalRef: () => terminalRefs.current.get(activeTab) ?? null,
   }), [activeTab, tabs, canAddTab, addTab, closeTab, setActiveTab, isAnyModalOpen])



  if (headless) {
    return (
      <div className={`h-full ${className}`}>
        <div className="h-full relative">
          {tabs.map((tab) => {
            const isActive = tab.index === activeTab
            return (
              <div
                key={tab.terminalId}
                className={`absolute inset-0 transition-opacity duration-150 ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                style={{ visibility: isActive ? 'visible' : 'hidden' }}
                aria-hidden={!isActive}
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
                  workingDirectory={workingDirectory}
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div
        className="h-8 flex-shrink-0 flex items-center overflow-x-auto scrollbar-hide"
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
            onClose={tabs.length > 1 ? () => { void closeTab(tab.index) } : undefined}
            onMiddleClick={tabs.length > 1 ? () => { void closeTab(tab.index) } : undefined}
            showCloseButton={tabs.length > 1}
            className="h-full"
            style={{
              maxWidth: '150px',
              minWidth: '100px'
            }}
          />
        ))}
        
        {canAddTab && (
          <AddTerminalButton
            onClick={() => { void addTab() }}
            title="Add new terminal"
            ariaLabel="Add new terminal"
            className="ml-2 h-7 w-7"
          />
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => {
          const isActive = tab.index === activeTab
          return (
            <div
              key={tab.terminalId}
              className={`absolute inset-0 transition-opacity duration-150 ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              style={{ visibility: isActive ? 'visible' : 'hidden' }}
              aria-hidden={!isActive}
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
                workingDirectory={workingDirectory}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})

TerminalTabsComponent.displayName = 'TerminalTabs';

export const TerminalTabs = memo(TerminalTabsComponent)

TerminalTabs.displayName = 'TerminalTabs'
