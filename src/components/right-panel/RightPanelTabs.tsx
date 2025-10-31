import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection, type Selection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../contexts/SessionsContext'
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
import { RightPanelTabsHeader } from './RightPanelTabsHeader'
import type { TabKey } from './RightPanelTabs.types'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

interface RightPanelTabsProps {
  onFileSelect: (filePath: string) => void
  onOpenHistoryDiff?: (payload: { repoPath: string; commit: HistoryItem; files: CommitFileChange[]; initialFilePath?: string | null }) => void
  selectionOverride?: Selection
  isSpecOverride?: boolean
  isDragging?: boolean
}

const RightPanelTabsComponent = ({ onFileSelect, onOpenHistoryDiff, selectionOverride, isSpecOverride, isDragging = false }: RightPanelTabsProps) => {
  const { selection, isSpec, setSelection } = useSelection()
  const projectPath = useAtomValue(projectPathAtom)
  const { setFocusForSession, currentFocus } = useFocus()
  const { allSessions } = useSessions()
  const [userSelectedTab, setUserSelectedTabRaw] = useState<TabKey | null>(null)
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
  const sessionWorktreePath = effectiveSelection.kind === 'session'
    ? effectiveSelection.worktreePath ?? currentSession?.info.worktree_path ?? null
    : null
  const historyRepoPath = sessionWorktreePath ?? projectPath ?? null
  const historySessionName = effectiveSelection.kind === 'session'
    ? currentSession?.info.session_id ?? (typeof effectiveSelection.payload === 'string' ? effectiveSelection.payload : null)
    : null

  const selectionKey = useMemo(() => {
    if (effectiveSelection.kind === 'orchestrator') {
      return 'orchestrator'
    }
    if (effectiveSelection.kind === 'session') {
      const id = typeof effectiveSelection.payload === 'string' ? effectiveSelection.payload : null
      if (id) return `session:${id}`
    }
    return null
  }, [effectiveSelection])

  const tabSelectionCacheRef = useRef<Map<string, TabKey>>(new Map())

  const setUserSelectedTab = useCallback((next: TabKey | null) => {
    setUserSelectedTabRaw(next)
    if (!selectionKey) return
    if (next) {
      tabSelectionCacheRef.current.set(selectionKey, next)
    } else {
      tabSelectionCacheRef.current.delete(selectionKey)
    }
  }, [selectionKey])

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

  // Reset cached selections when project changes
  useEffect(() => {
    tabSelectionCacheRef.current.clear()
    setUserSelectedTabRaw(null)
  }, [projectPath])

  const lastSessionSelectionRef = useRef<{ id: string | null; isSpec: boolean } | null>(null)

  // Reset tab selection when switching between sessions or spec/running states
  useEffect(() => {
    if (effectiveSelection.kind !== 'session') {
      lastSessionSelectionRef.current = null
      return
    }

    const sessionId = typeof effectiveSelection.payload === 'string' ? effectiveSelection.payload : null
    const previous = lastSessionSelectionRef.current
    const hasSessionChanged = previous?.id !== sessionId
    const hasSpecStateChanged = previous?.isSpec !== effectiveIsSpec

    if (hasSessionChanged || hasSpecStateChanged) {
      if (!effectiveIsSpec && sessionId) {
        const cached = tabSelectionCacheRef.current.get(`session:${sessionId}`)
        if (cached) {
          setUserSelectedTabRaw(cached)
        } else {
          setUserSelectedTabRaw(null)
        }
      } else {
        setUserSelectedTabRaw(null)
      }
    }

    lastSessionSelectionRef.current = { id: sessionId, isSpec: effectiveIsSpec }
  }, [effectiveSelection, effectiveIsSpec])

  // Restore cached tab for orchestrator when switching back
  useEffect(() => {
    if (effectiveSelection.kind === 'orchestrator') {
      const cached = selectionKey ? tabSelectionCacheRef.current.get(selectionKey) : null
      if (cached) {
        setUserSelectedTabRaw(cached)
      } else {
        setUserSelectedTabRaw(null)
      }
    }
  }, [effectiveSelection.kind, selectionKey])

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
  }, [effectiveSelection, activeTab, keyboardShortcutConfig, platform, setUserSelectedTab])

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
  }, [effectiveSelection.kind, openSpecInWorkspace, openTabs, setUserSelectedTab])

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
  }, [setUserSelectedTab])

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
  const isRunningSession = effectiveSelection.kind === 'session' && !effectiveIsSpec
  const showChangesTab = isCommander || isRunningSession
  const showInfoTab = effectiveSelection.kind === 'session' && effectiveIsSpec
  const showSpecTab = isRunningSession
  const showHistoryTab = isCommander || isRunningSession || (effectiveSelection.kind === 'session' && effectiveIsSpec)
  const showSpecsTab = isCommander
  const tabsPresent = showChangesTab || showInfoTab || showSpecTab || showHistoryTab || showSpecsTab
  // Enable split mode when viewing Changes for normal running sessions
  const useSplitMode = isRunningSession && activeTab === 'changes'

  return (
    <div 
      className={`h-full flex flex-col bg-panel border-2 rounded ${localFocus ? 'border-cyan-400/60 shadow-lg shadow-cyan-400/20' : 'border-slate-800/50'}`}
      onClick={handlePanelClick}
    >
      {/* Header */}
      {tabsPresent && (
        <RightPanelTabsHeader
          activeTab={activeTab}
          localFocus={localFocus}
          showChangesTab={showChangesTab}
          showHistoryTab={showHistoryTab}
          showInfoTab={showInfoTab}
          showSpecTab={showSpecTab}
          showSpecsTab={showSpecsTab}
          onSelectTab={tab => setUserSelectedTab(tab)}
        />
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
              <GitGraphPanel
                onOpenCommitDiff={onOpenHistoryDiff}
                repoPath={historyRepoPath}
                sessionName={historySessionName}
              />
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
            ) : activeTab === 'agent' ? (
              effectiveSelection.kind === 'session' ? (
                <SpecContentView
                  sessionName={effectiveSelection.payload!}
                  editable={false}
                  debounceMs={1000}
                  sessionState={sessionState}
                />
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

RightPanelTabsComponent.displayName = 'RightPanelTabs'

export const RightPanelTabs = memo(RightPanelTabsComponent)
