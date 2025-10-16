import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../contexts/SessionsContext'
import { VscDiff, VscNotebook, VscInfo, VscGitCommit } from 'react-icons/vsc'
import clsx from 'clsx'
import { SpecContentView as SpecContentView } from '../plans/SpecContentView'
import { SpecInfoPanel as SpecInfoPanel } from '../plans/SpecInfoPanel'
import { SpecMetadataPanel as SpecMetadataPanel } from '../plans/SpecMetadataPanel'
import { GitGraphPanel } from '../git-graph/GitGraphPanel'
import type { HistoryItem, CommitFileChange } from '../git-graph/types'
import Split from 'react-split'
import { CopyBundleBar } from './CopyBundleBar'
import { logger } from '../../utils/logger'
import { emitUiEvent, UiEvent, listenUiEvent } from '../../common/uiEvents'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { beginSplitDrag, endSplitDrag } from '../../utils/splitDragCoordinator'
import { SpecWorkspacePanel } from '../specs/SpecWorkspacePanel'
import { useSpecMode } from '../../hooks/useSpecMode'
import { isSpec as isSpecSession } from '../../utils/sessionFilters'
import { FilterMode } from '../../types/sessionFilters'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  onOpenHistoryDiff?: (payload: { repoPath: string; commit: HistoryItem; files: CommitFileChange[]; initialFilePath?: string | null }) => void
  selectionOverride?: { kind: 'session' | 'orchestrator'; payload?: string | null }
  isSpecOverride?: boolean
  isDragging?: boolean
}

const RightPanelTabsComponent = ({ onFileSelect, onOpenHistoryDiff, selectionOverride, isSpecOverride, isDragging = false }: RightPanelTabsProps) => {
  const { selection, isSpec, setSelection } = useSelection()
  const { projectPath } = useProject()
  const { setFocusForSession, currentFocus } = useFocus()
  const { allSessions } = useSessions()
  const [userSelectedTab, setUserSelectedTab] = useState<'changes' | 'agent' | 'info' | 'history' | 'specs' | null>(null)
  const [localFocus, setLocalFocus] = useState<boolean>(false)
  const [showSpecPicker, setShowSpecPicker] = useState(false)
  const [pendingSpecToOpen, setPendingSpecToOpen] = useState<string | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])

  const specModeHook = useSpecMode({
    projectPath,
    selection,
    sessions: allSessions,
    setFilterMode: () => {},
    setSelection,
    currentFilterMode: FilterMode.All
  })

  const { openSpecInWorkspace, closeSpecTab, openTabs, activeTab: specActiveTab } = specModeHook

  const effectiveSelection = selectionOverride ?? selection
  const currentSession = effectiveSelection.kind === 'session' && effectiveSelection.payload
    ? allSessions.find(s => s.info.session_id === effectiveSelection.payload || s.info.branch === effectiveSelection.payload)
    : null
  const sessionState = currentSession?.info.session_state as ('spec' | 'running' | 'reviewed') | undefined

    // Drag handlers for internal split
    const internalSplitActiveRef = useRef(false)

    const finalizeInternalSplitDrag = useCallback(() => {
      if (!internalSplitActiveRef.current) return
      internalSplitActiveRef.current = false

      endSplitDrag('right-panel-internal')

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

    const handleInternalSplitDragStart = useCallback(() => {
      beginSplitDrag('right-panel-internal')
      internalSplitActiveRef.current = true
    }, [])

    const handleInternalSplitDragEnd = useCallback(() => {
      finalizeInternalSplitDrag()
    }, [finalizeInternalSplitDrag])

    useEffect(() => {
      const handlePointerEnd = () => finalizeInternalSplitDrag()
      window.addEventListener('pointerup', handlePointerEnd)
      window.addEventListener('pointercancel', handlePointerEnd)
      window.addEventListener('blur', handlePointerEnd)
      return () => {
        window.removeEventListener('pointerup', handlePointerEnd)
        window.removeEventListener('pointercancel', handlePointerEnd)
        window.removeEventListener('blur', handlePointerEnd)
      }
    }, [finalizeInternalSplitDrag])

    useEffect(() => () => {
      if (internalSplitActiveRef.current) {
        internalSplitActiveRef.current = false
        endSplitDrag('right-panel-internal')
      }
    }, [])

   // Determine active tab based on user selection or smart defaults
   // For specs, always show info tab regardless of user selection
   const effectiveIsSpec = typeof isSpecOverride === 'boolean' ? isSpecOverride : isSpec
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsSpec) ? 'info' : (
    userSelectedTab || (
      effectiveSelection.kind === 'orchestrator' ? 'changes' : 'changes'
    )
  )

  // Reset state when project changes
  useEffect(() => {
    setUserSelectedTab(null)
  }, [projectPath])

  // Get spec sessions for workspace
  const specSessions = allSessions.filter(session => isSpecSession(session.info))

  // Update local focus state when global focus changes
  useEffect(() => {
    setLocalFocus(currentFocus === 'diff')
  }, [currentFocus])

  // Keyboard shortcut for focusing Specs tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutForAction(e, KeyboardShortcutAction.FocusSpecsTab, keyboardShortcutConfig, { platform })) {
        if (effectiveSelection.kind === 'orchestrator') {
          e.preventDefault()
          if (activeTab === 'specs') {
            setUserSelectedTab(null)
          } else {
            setUserSelectedTab('specs')
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveSelection, activeTab, keyboardShortcutConfig, platform])

  // Track previous specs to detect creation/modification via MCP API
  const previousSpecsRef = useRef<Map<string, string>>(new Map())
  const allSessionsRef = useRef(allSessions)

  useEffect(() => {
    allSessionsRef.current = allSessions
  }, [allSessions])

  // Listen for SessionsRefreshed and emit SpecCreated for new/modified specs
  useEffect(() => {
    if (effectiveSelection.kind !== 'orchestrator') return

    let unlistenFn: (() => void) | null = null

    listenEvent(SchaltEvent.SessionsRefreshed, () => {
      const currentSpecs = allSessionsRef.current.filter(session => isSpecSession(session.info))
      const previousSpecs = previousSpecsRef.current

      currentSpecs.forEach(spec => {
        const specId = spec.info.session_id
        const specContent = spec.info.spec_content || ''
        const previousContent = previousSpecs.get(specId)

        if (previousContent === undefined) {
          logger.info('[RightPanelTabs] New spec detected via SessionsRefreshed:', specId)
          emitUiEvent(UiEvent.SpecCreated, { name: specId })
        } else if (previousContent !== specContent && specContent.length > 0) {
          logger.info('[RightPanelTabs] Modified spec detected via SessionsRefreshed:', specId)
          emitUiEvent(UiEvent.SpecCreated, { name: specId })
        }
      })

      const newMap = new Map<string, string>()
      currentSpecs.forEach(spec => {
        newMap.set(spec.info.session_id, spec.info.spec_content || '')
      })
      previousSpecsRef.current = newMap
    }).then(unlisten => {
      unlistenFn = unlisten
    }).catch(err => {
      logger.warn('[RightPanelTabs] Failed to setup SessionsRefreshed listener', err)
    })

    return () => {
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [effectiveSelection.kind])

  // Auto-open specs when orchestrator creates/modifies them
  useEffect(() => {
    if (effectiveSelection.kind !== 'orchestrator') return

    const cleanupSpecCreated = listenUiEvent(UiEvent.SpecCreated, (detail) => {
      if (detail?.name) {
        if (openTabs.includes(detail.name)) {
          logger.info('[RightPanelTabs] Spec already open in workspace, skipping auto-switch:', detail.name)
          return
        }
        logger.info('[RightPanelTabs] Spec created by orchestrator:', detail.name, '- auto-opening in workspace')
        setUserSelectedTab('specs')
        openSpecInWorkspace(detail.name)
      }
    })

    return () => {
      cleanupSpecCreated()
    }
  }, [effectiveSelection.kind, openSpecInWorkspace, openTabs])

  // Listen for OpenSpecInOrchestrator events
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenSpecInOrchestrator, (detail) => {
      if (detail?.sessionName) {
        logger.info('[RightPanelTabs] Received OpenSpecInOrchestrator event for spec:', detail.sessionName)
        setPendingSpecToOpen(detail.sessionName)
        setUserSelectedTab('specs')
      }
    })

    return cleanup
  }, [])

  // When selection becomes orchestrator and we have a pending spec, open it
  useEffect(() => {
    if (effectiveSelection.kind === 'orchestrator' && pendingSpecToOpen) {
      logger.info('[RightPanelTabs] Orchestrator selected, opening pending spec:', pendingSpecToOpen)
      openSpecInWorkspace(pendingSpecToOpen)
      setPendingSpecToOpen(null)
    }
  }, [effectiveSelection.kind, pendingSpecToOpen, openSpecInWorkspace])
  
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
  const showHistoryTab = isCommander
  const showSpecsTab = isCommander

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
          {showHistoryTab && (
            <button
              onClick={() => setUserSelectedTab('history')}
              className={clsx(
                'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
                activeTab === 'history'
                  ? localFocus
                    ? 'text-cyan-200 bg-cyan-800/30'
                    : 'text-slate-200 bg-slate-800/50'
                  : localFocus
                    ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-800/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              )}
              data-active={activeTab === 'history' || undefined}
              title="Git History"
            >
              <VscGitCommit className="text-sm" />
              <span>History</span>
            </button>
          )}
          {showSpecsTab && (
            <button
              onClick={() => setUserSelectedTab('specs')}
              className={clsx(
                'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
                activeTab === 'specs'
                  ? localFocus
                    ? 'text-cyan-200 bg-cyan-800/30'
                    : 'text-slate-200 bg-slate-800/50'
                  : localFocus
                    ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-800/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              )}
              data-active={activeTab === 'specs' || undefined}
              title="Specs Workspace"
            >
              <VscNotebook className="text-sm" />
              <span>Specs</span>
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
            ) : activeTab === 'history' ? (
              <GitGraphPanel onOpenCommitDiff={onOpenHistoryDiff} />
            ) : activeTab === 'specs' ? (
              <SpecWorkspacePanel
                specs={specSessions}
                openTabs={openTabs}
                activeTab={specActiveTab}
                onTabChange={openSpecInWorkspace}
                onTabClose={closeSpecTab}
                onOpenPicker={() => setShowSpecPicker(true)}
                showPicker={showSpecPicker}
                onPickerClose={() => setShowSpecPicker(false)}
                onStart={(specId) => {
                  logger.info('[RightPanelTabs] Starting spec agent:', specId)
                  closeSpecTab(specId)
                  emitUiEvent(UiEvent.StartAgentFromSpec, { name: specId })
                }}
              />
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

RightPanelTabsComponent.displayName = 'RightPanelTabs'

export const RightPanelTabs = memo(RightPanelTabsComponent)
