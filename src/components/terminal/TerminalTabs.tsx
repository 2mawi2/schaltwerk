import { useRef, forwardRef, useImperativeHandle } from 'react'
import { Terminal, TerminalHandle } from './Terminal'
import { useTerminalTabs } from '../../hooks/useTerminalTabs'

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
    }
  }), [activeTab])

  const handleTabClick = (e: React.MouseEvent, tabIndex: number) => {
    e.stopPropagation()
    setActiveTab(tabIndex)
    // Focus the terminal after a brief delay
    setTimeout(() => {
      const activeTerminalRef = terminalRefs.current.get(tabIndex)
      if (activeTerminalRef) {
        activeTerminalRef.focus()
      }
    }, 50)
  }

  const handleTabClose = (e: React.MouseEvent, tabIndex: number) => {
    e.stopPropagation()
    closeTab(tabIndex)
  }

  const handleTabMouseDown = (e: React.MouseEvent, tabIndex: number) => {
    if (e.button === 1) {
      e.stopPropagation()
      closeTab(tabIndex)
    }
  }


  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div className="h-8 flex-shrink-0 bg-slate-900/50">
        <div className="h-full flex items-center overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <div
              key={tab.index}
              className={`
                relative h-full flex items-center px-3 text-xs cursor-pointer border-r border-slate-800/50 min-w-0 max-w-32 transition-all duration-200
                ${tab.index === activeTab 
                  ? 'bg-blue-900/30 text-blue-200' 
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                }
              `}
              onClick={(e) => handleTabClick(e, tab.index)}
              onMouseDown={(e) => handleTabMouseDown(e, tab.index)}
            >
              <span className="truncate flex-1">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleTabClose(e, tab.index)}
                  className="ml-2 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300"
                  title="Close tab"
                >
                  ×
                </button>
              )}
              {tab.index === activeTab && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500/80" />
              )}
            </div>
          ))}
          
          {canAddTab && (
            <button
              onClick={addTab}
              className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 border-r border-slate-800/50"
              title="Add new terminal"
            >
              +
            </button>
          )}
        </div>
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