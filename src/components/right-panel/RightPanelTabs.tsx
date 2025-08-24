import { useState, useEffect } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { VscDiff, VscChevronLeft, VscNotebook } from 'react-icons/vsc'
import clsx from 'clsx'
import { DraftContentView } from '../drafts/DraftContentView'
import { DraftListView } from '../drafts/DraftListView'
import { DraftInfoPanel } from '../drafts/DraftInfoPanel'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  selectionOverride?: { kind: 'session' | 'orchestrator'; payload?: string | null }
  isDraftOverride?: boolean
}

export function RightPanelTabs({ onFileSelect, selectionOverride, isDraftOverride }: RightPanelTabsProps) {
  const { selection, isDraft } = useSelection()
  const { projectPath } = useProject()
  const [userSelectedTab, setUserSelectedTab] = useState<'changes' | 'task' | null>(null)
  const [previewDraftName, setPreviewDraftName] = useState<string | null>(null)

  // Determine active tab based on user selection or smart defaults
  // For drafts, always show task tab regardless of user selection
  const effectiveSelection = selectionOverride ?? selection
  const effectiveIsDraft = typeof isDraftOverride === 'boolean' ? isDraftOverride : isDraft
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsDraft) ? 'task' : (
    userSelectedTab || (
      effectiveSelection.kind === 'orchestrator' ? 'task' : 'changes'
    )
  )

  // Reset preview when leaving orchestrator
  useEffect(() => {
    if (selection.kind !== 'orchestrator') setPreviewDraftName(null)
  }, [selection])

  // Reset state when project changes
  useEffect(() => {
    setUserSelectedTab(null)
    setPreviewDraftName(null)
  }, [projectPath])

  // Note: removed Cmd+D toggle to reserve shortcut for New Draft

  // Unified header with tabs
  const isOrchestrator = effectiveSelection.kind === 'orchestrator'
  const rightTabLabel = isOrchestrator ? 'Drafts' : 'Task'
  const showBackButton = isOrchestrator && !!previewDraftName
  const showChangesTab = effectiveSelection.kind === 'session' && !effectiveIsDraft

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
          onClick={() => setUserSelectedTab('task')}
          className={clsx(
            'h-full flex-1 px-3 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
            activeTab === 'task' ? 'text-slate-200 bg-slate-800/50' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          )}
          title={`${rightTabLabel}`}
        >
          <VscNotebook className="text-sm" />
          <span>{rightTabLabel}</span>
        </button>
      </div>

      {/* Back/breadcrumb row when previewing a draft in orchestrator */}
      {showBackButton && (
        <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1"
            onClick={() => setPreviewDraftName(null)}
            title="Back to drafts"
          >
            <VscChevronLeft />
            Back
          </button>
          <div className="text-xs text-slate-400">Viewing draft: {previewDraftName}</div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'changes' ? (
          <SimpleDiffPanel 
            onFileSelect={onFileSelect} 
            sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
          />
        ) : (
          // Task/Drafts tab content
          effectiveSelection.kind === 'session' ? (
            // For draft sessions, show the info panel; for running sessions, show the task content
            effectiveIsDraft ? (
              <DraftInfoPanel sessionName={effectiveSelection.payload!} />
            ) : (
              <DraftContentView 
                sessionName={effectiveSelection.payload!} 
                editable={false} 
                debounceMs={1000} 
              />
            )
          ) : (
            previewDraftName ? (
              <DraftContentView sessionName={previewDraftName} editable debounceMs={1000} />
            ) : (
              <DraftListView onOpenDraft={(name) => setPreviewDraftName(name)} />
            )
          )
        )}
      </div>
    </div>
  )
}
