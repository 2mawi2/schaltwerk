import { useState, useEffect } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { useFocus } from '../../contexts/FocusContext'
import { VscDiff, VscNotebook, VscInfo } from 'react-icons/vsc'
import clsx from 'clsx'
import { PlanContentView } from '../plans/PlanContentView'
import { PlanListView } from '../plans/PlanListView'
import { PlanInfoPanel } from '../plans/PlanInfoPanel'
import { PlanMetadataPanel } from '../plans/PlanMetadataPanel'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  selectionOverride?: { kind: 'session' | 'orchestrator'; payload?: string | null }
  isPlanOverride?: boolean
}

export function RightPanelTabs({ onFileSelect, selectionOverride, isPlanOverride }: RightPanelTabsProps) {
  const { selection, isPlan } = useSelection()
  const { projectPath } = useProject()
  const { setFocusForSession, currentFocus } = useFocus()
  const [userSelectedTab, setUserSelectedTab] = useState<'changes' | 'agent' | 'info' | null>(null)
  const [previewPlanName, setPreviewPlanName] = useState<string | null>(null)
  const [localFocus, setLocalFocus] = useState<boolean>(false)

  // Determine active tab based on user selection or smart defaults
  // For plans, always show info tab regardless of user selection
  const effectiveSelection = selectionOverride ?? selection
  const effectiveIsPlan = typeof isPlanOverride === 'boolean' ? isPlanOverride : isPlan
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsPlan) ? 'info' : (
    userSelectedTab || (
      effectiveSelection.kind === 'orchestrator' ? 'agent' : 'changes'
    )
  )

  // Reset state when project changes
  useEffect(() => {
    setUserSelectedTab(null)
  }, [projectPath])
  
  // Update local focus state when global focus changes
  useEffect(() => {
    setLocalFocus(currentFocus === 'diff')
  }, [currentFocus])
  
  const handlePanelClick = () => {
    const sessionKey = effectiveSelection.kind === 'orchestrator' ? 'orchestrator' : effectiveSelection.payload || 'unknown'
    setFocusForSession(sessionKey, 'diff')
    setLocalFocus(true)
  }

  // Note: removed Cmd+D toggle to reserve shortcut for New Plan

  // Unified header with tabs
  const isCommander = effectiveSelection.kind === 'orchestrator'
  const rightTabLabel = 'Plan'
  const showChangesTab = (effectiveSelection.kind === 'session' && !effectiveIsPlan) || isCommander
  const showInfoTab = effectiveSelection.kind === 'session' && effectiveIsPlan

  return (
    <div 
      className={`h-full flex flex-col bg-panel border-2 rounded transition-all duration-200 ease-in-out ${localFocus ? 'border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border-slate-800/50'}`}
      onClick={handlePanelClick}
    >
      <div className="h-8 flex items-center border-b border-slate-800">
        {showChangesTab && (
          <button
            onClick={() => setUserSelectedTab('changes')}
            className={clsx(
              'h-full px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              isCommander ? 'flex-1' : '',
              activeTab === 'changes' 
                ? localFocus 
                  ? 'text-blue-200 bg-blue-800/30' 
                  : 'text-slate-200 bg-slate-800/50'
                : localFocus
                  ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-800/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            )}
            title="Changes"
          >
            <VscDiff className="text-sm" />
            <span>Changes</span>
          </button>
        )}
        {showInfoTab && (
          <button
            onClick={() => setUserSelectedTab('info')}
            className={clsx(
              'h-full flex-1 px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              activeTab === 'info' 
                ? localFocus 
                  ? 'text-blue-200 bg-blue-800/30' 
                  : 'text-slate-200 bg-slate-800/50'
                : localFocus
                  ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-800/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            )}
            title="Plan Info"
          >
            <VscInfo className="text-sm" />
            <span>Info</span>
          </button>
        )}
        {!showInfoTab && (
          <button
            onClick={() => setUserSelectedTab('agent')}
            className={clsx(
              'h-full flex-1 px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              activeTab === 'agent' 
                ? localFocus 
                  ? 'text-blue-200 bg-blue-800/30' 
                  : 'text-slate-200 bg-slate-800/50'
                : localFocus
                  ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-800/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            )}
            title={`${rightTabLabel}`}
          >
            <VscNotebook className="text-sm" />
            <span>{rightTabLabel}</span>
          </button>
        )}
      </div>
      <div className={`h-[2px] flex-shrink-0 transition-opacity duration-200 ${
        localFocus
          ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent' 
          : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
      }`} />

      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 animate-fadeIn" key={activeTab}>
          {activeTab === 'changes' ? (
            <SimpleDiffPanel 
              onFileSelect={onFileSelect} 
              sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
              isCommander={effectiveSelection.kind === 'orchestrator'}
            />
          ) : activeTab === 'info' ? (
            // Info tab for plans - shows metadata instead of changes
            effectiveSelection.kind === 'session' && effectiveIsPlan ? (
              <PlanMetadataPanel sessionName={effectiveSelection.payload!} />
            ) : null
          ) : (
            // Agent/Plans tab content
            effectiveSelection.kind === 'session' ? (
              // For plan sessions, show the info panel; for running sessions, show the agent content
              effectiveIsPlan ? (
                <PlanInfoPanel sessionName={effectiveSelection.payload!} />
              ) : (
                <PlanContentView 
                  sessionName={effectiveSelection.payload!} 
                  editable={false} 
                  debounceMs={1000} 
                />
              )
            ) : (
              previewPlanName ? (
                <PlanContentView sessionName={previewPlanName} editable debounceMs={1000} />
              ) : (
                <PlanListView onOpenPlan={(name: string) => setPreviewPlanName(name)} />
              )
            )
          )}
        </div>
      </div>
    </div>
  )
}
