import { useState, useEffect } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { VscDiff, VscChevronLeft, VscNotebook } from 'react-icons/vsc'
import clsx from 'clsx'
import { PlanContentView } from '../plans/PlanContentView'
import { PlanListView } from '../plans/PlanListView'
import { PlanInfoPanel } from '../plans/PlanInfoPanel'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  selectionOverride?: { kind: 'session' | 'commander'; payload?: string | null }
  isPlanOverride?: boolean
}

export function RightPanelTabs({ onFileSelect, selectionOverride, isPlanOverride }: RightPanelTabsProps) {
  const { selection, isPlan } = useSelection()
  const { projectPath } = useProject()
  const [userSelectedTab, setUserSelectedTab] = useState<'changes' | 'agent' | null>(null)
  const [previewPlanName, setPreviewPlanName] = useState<string | null>(null)

  // Determine active tab based on user selection or smart defaults
  // For plans, always show agent tab regardless of user selection
  const effectiveSelection = selectionOverride ?? selection
  const effectiveIsPlan = typeof isPlanOverride === 'boolean' ? isPlanOverride : isPlan
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsPlan) ? 'agent' : (
    userSelectedTab || (
      effectiveSelection.kind === 'commander' ? 'agent' : 'changes'
    )
  )

  // Reset preview when leaving commander
  useEffect(() => {
    if (selection.kind !== 'commander') setPreviewPlanName(null)
  }, [selection])

  // Reset state when project changes
  useEffect(() => {
    setUserSelectedTab(null)
    setPreviewPlanName(null)
  }, [projectPath])

  // Note: removed Cmd+D toggle to reserve shortcut for New Plan

  // Unified header with tabs
  const isCommander = effectiveSelection.kind === 'commander'
  const rightTabLabel = isCommander ? 'Plans' : 'Agent'
  const showBackButton = isCommander && !!previewPlanName
  const showChangesTab = (effectiveSelection.kind === 'session' && !effectiveIsPlan) || isCommander

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="h-8 flex items-center border-b border-slate-800">
        {showChangesTab && (
          <button
            onClick={() => setUserSelectedTab('changes')}
            className={clsx(
              'h-full flex-1 px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
              activeTab === 'changes' ? 'text-slate-200 bg-slate-800/50' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            )}
            title="Changes"
          >
            <VscDiff className="text-sm" />
            <span>Changes</span>
          </button>
        )}
        <button
          onClick={() => setUserSelectedTab('agent')}
          className={clsx(
            'h-full flex-1 px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'agent' ? 'text-slate-200 bg-slate-800/50' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title={`${rightTabLabel}`}
        >
          <VscNotebook className="text-sm" />
          <span>{rightTabLabel}</span>
        </button>
      </div>

      {/* Back/breadcrumb row when previewing a plan in commander */}
      {showBackButton && (
        <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1"
            onClick={() => setPreviewPlanName(null)}
            title="Back to plans"
          >
            <VscChevronLeft />
            Back
          </button>
          <div className="text-xs text-slate-400">Viewing plan: {previewPlanName}</div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <SimpleDiffPanel 
            onFileSelect={onFileSelect} 
            sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
            isCommander={effectiveSelection.kind === 'commander'}
          />
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
  )
}
