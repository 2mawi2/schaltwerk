import { useState, useEffect, useCallback } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../contexts/SessionsContext'
import { VscDiff, VscNotebook, VscInfo } from 'react-icons/vsc'
import clsx from 'clsx'
import { SpecContentView as SpecContentView } from '../plans/SpecContentView'
import { SpecInfoPanel as SpecInfoPanel } from '../plans/SpecInfoPanel'
import { SpecMetadataPanel as SpecMetadataPanel } from '../plans/SpecMetadataPanel'
import Split from 'react-split'
import { CopyBundleBar } from './CopyBundleBar'
import { logger } from '../../utils/logger'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  selectionOverride?: { kind: 'session' | 'orchestrator'; payload?: string | null }
  isSpecOverride?: boolean
  isDragging?: boolean
}

export function RightPanelTabs({ onFileSelect, selectionOverride, isSpecOverride, isDragging = false }: RightPanelTabsProps) {
  const { selection, isSpec } = useSelection()
  const { projectPath } = useProject()
  const { setFocusForSession, currentFocus } = useFocus()
  const { allSessions } = useSessions()
    const [userSelectedTab, setUserSelectedTab] = useState<'changes' | 'agent' | 'info' | null>(null)
    const [localFocus, setLocalFocus] = useState<boolean>(false)

  const effectiveSelection = selectionOverride ?? selection
  const currentSession = effectiveSelection.kind === 'session' && effectiveSelection.payload
    ? allSessions.find(s => s.info.session_id === effectiveSelection.payload || s.info.branch === effectiveSelection.payload)
    : null
  const sessionState = currentSession?.info.session_state as ('spec' | 'running' | 'reviewed') | undefined

    // Drag handlers for internal split
    const handleInternalSplitDragStart = useCallback(() => {
      document.body.classList.add('is-split-dragging')
    }, [])

    const handleInternalSplitDragEnd = useCallback(() => {
      document.body.classList.remove('is-split-dragging')

      // Dispatch OpenCode resize event when internal right panel split drag ends
      try {
        if (selection.kind === 'session' && selection.payload) {
          emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'session', sessionId: selection.payload })
        } else {
          emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'orchestrator' })
        }
      } catch (e) {
        logger.warn('[RightPanelTabs] Failed to dispatch OpenCode resize event on internal split drag end', e)
      }
    }, [selection])

   // Determine active tab based on user selection or smart defaults
   // For specs, always show info tab regardless of user selection
   const effectiveIsSpec = typeof isSpecOverride === 'boolean' ? isSpecOverride : isSpec
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsSpec) ? 'info' : (
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

  // Note: removed Cmd+D toggle to reserve shortcut for New Spec

  // Unified header with tabs
  const isCommander = effectiveSelection.kind === 'orchestrator'
  const showChangesTab = (effectiveSelection.kind === 'session' && !effectiveIsSpec) || isCommander
  const showInfoTab = effectiveSelection.kind === 'session' && effectiveIsSpec
  const showSpecTab = effectiveSelection.kind === 'session' && !effectiveIsSpec

  // Enable split mode for normal running sessions: Changes (top) + Requirements (bottom)
  const useSplitMode = effectiveSelection.kind === 'session' && !effectiveIsSpec

  return (
    <div 
      className={`h-full flex flex-col bg-panel border-2 rounded ${localFocus ? 'border-cyan-400/60 shadow-lg shadow-cyan-400/20' : 'border-slate-800/50'}`}
      onClick={handlePanelClick}
    >
      {/* Header: hide tabs when split mode is active */}
      {!useSplitMode && (
        <div className="h-8 flex items-center border-b border-slate-800">
          {showChangesTab && (
            <button
              onClick={() => setUserSelectedTab('changes')}
              className={clsx(
                'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
                activeTab === 'changes' 
                  ? localFocus 
                    ? 'text-blue-200 bg-blue-800/30' 
                    : 'text-slate-200 bg-slate-800/50'
                  : localFocus
                    ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-800/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              )}
              data-active={activeTab === 'changes' || undefined}
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
                'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
                activeTab === 'info'
                  ? localFocus
                    ? 'text-cyan-200 bg-cyan-800/30'
                    : 'text-slate-200 bg-slate-800/50'
                  : localFocus
                    ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-800/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              )}
              data-active={activeTab === 'info' || undefined}
              title="Spec Info"
            >
              <VscInfo className="text-sm" />
              <span>Info</span>
            </button>
          )}
          {showSpecTab && (
            <button
              onClick={() => setUserSelectedTab('agent')}
              className={clsx(
                'h-full flex-1 px-3 text-xs font-medium flex items center justify-center gap-1.5',
                activeTab === 'agent'
                  ? localFocus
                    ? 'text-cyan-200 bg-cyan-800/30'
                    : 'text-slate-200 bg-slate-800/50'
                  : localFocus
                    ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-800/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              )}
              data-active={activeTab === 'agent' || undefined}
              title="Spec"
            >
              <VscNotebook className="text-sm" />
              <span>Spec</span>
            </button>
          )}
        </div>
      )}

      <div className={`h-[2px] flex-shrink-0 ${
        localFocus && !isDragging
          ? 'bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent'
          : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
      }`} />

      {/* Body: split mode for running sessions; tabbed mode otherwise */}
      <div className="flex-1 overflow-hidden relative">
        {useSplitMode ? (
          <Split
            data-testid="right-split"
            className="h-full flex flex-col"
            sizes={[58, 42]}
            minSize={[140, 120]}
            gutterSize={8}
            direction="vertical"
            onDragStart={handleInternalSplitDragStart}
            onDragEnd={handleInternalSplitDragEnd}
          >
            {/* Top: Changes */}
            <div className="min-h-[120px] overflow-hidden">
              <SimpleDiffPanel 
                onFileSelect={onFileSelect} 
                sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
                isCommander={effectiveSelection.kind === 'orchestrator'}
              />
            </div>
            {/* Bottom: Spec content with copy bar */}
            <div className="min-h-[120px] overflow-hidden flex flex-col">
              {effectiveSelection.kind === 'session' && (
                <>
                  <CopyBundleBar sessionName={effectiveSelection.payload!} />
                  <SpecContentView
                    sessionName={effectiveSelection.payload!}
                    editable={false}
                    debounceMs={1000}
                    sessionState={sessionState}
                  />
                </>
              )}
            </div>
          </Split>
        ) : (
          <div className="absolute inset-0" key={activeTab}>
            {activeTab === 'changes' ? (
              <SimpleDiffPanel 
                onFileSelect={onFileSelect} 
                sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
                isCommander={effectiveSelection.kind === 'orchestrator'}
              />
            ) : activeTab === 'info' ? (
              effectiveSelection.kind === 'session' && effectiveIsSpec ? (
                <SpecMetadataPanel sessionName={effectiveSelection.payload!} />
              ) : null
            ) : (
              effectiveSelection.kind === 'session' ? (
                effectiveIsSpec ? (
                  <SpecInfoPanel sessionName={effectiveSelection.payload!} />
                ) : (
                  <SpecContentView
                    sessionName={effectiveSelection.payload!}
                    editable={false}
                    debounceMs={1000}
                    sessionState={sessionState}
                  />
                )
              ) : (
                <SimpleDiffPanel
                  onFileSelect={onFileSelect}
                  sessionNameOverride={undefined}
                  isCommander={true}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
