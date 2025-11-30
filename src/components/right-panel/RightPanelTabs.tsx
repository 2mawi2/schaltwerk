import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import { SimpleDiffPanel } from '../diff/SimpleDiffPanel'
import { useSelection, type Selection } from '../../hooks/useSelection'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../hooks/useSessions'
import { SpecContentView as SpecContentView } from '../specs/SpecContentView'
import { SpecInfoPanel as SpecInfoPanel } from '../specs/SpecInfoPanel'
import { SpecMetadataPanel as SpecMetadataPanel } from '../specs/SpecMetadataPanel'
import { GitGraphPanel } from '../git-graph/GitGraphPanel'
import type { HistoryItem, CommitFileChange } from '../git-graph/types'
import Split from 'react-split'
import { CopyContextBar } from './CopyContextBar'
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
import { useAtom, useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { WebPreviewPanel } from './WebPreviewPanel'
import { buildPreviewKey } from '../../store/atoms/preview'
import { SPLIT_GUTTER_SIZE } from '../../common/splitLayout'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { rightPanelTabAtom } from '../../store/atoms/rightPanelTab'

interface RightPanelTabsProps {
  onOpenHistoryDiff?: (payload: { repoPath: string; commit: HistoryItem; files: CommitFileChange[]; initialFilePath?: string | null }) => void
  selectionOverride?: Selection
  isSpecOverride?: boolean
  isDragging?: boolean
  onInlineReviewModeChange?: (isInlineReviewing: boolean, opts?: { reformatSidebar: boolean, hasFiles?: boolean }) => void
}

const RightPanelTabsComponent = ({ onOpenHistoryDiff, selectionOverride, isSpecOverride, isDragging = false, onInlineReviewModeChange }: RightPanelTabsProps) => {
  const { selection, isSpec, setSelection } = useSelection()
  const projectPath = useAtomValue(projectPathAtom)
  const { setFocusForSession, currentFocus } = useFocus()
  const { allSessions } = useSessions()
  const [rightPanelTab, setRightPanelTab] = useAtom(rightPanelTabAtom)
  const [localFocus, setLocalFocus] = useState<boolean>(false)
  const [showSpecPicker, setShowSpecPicker] = useState(false)
  const [pendingSpecToOpen, setPendingSpecToOpen] = useState<string | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const [changesPanelMode, setChangesPanelMode] = useState<'list' | 'review'>('list')
  const [activeChangesFile, setActiveChangesFile] = useState<string | null>(null)
  const [inlineDiffDefault, setInlineDiffDefault] = useState<boolean | null>(null)
  const [inlineHasFiles, setInlineHasFiles] = useState(true)
  const diffContainerRef = useRef<HTMLDivElement>(null)
  const [reformatSidebarEnabled, setReformatSidebarEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('schaltwerk:inlineReformatSidebar')
    if (stored === 'false') return false
    return true
  })

  const specModeHook = useSpecMode({
    projectPath,
    selection,
    sessions: allSessions,
    setFilterMode: () => { },
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

  const previewKey = useMemo(() => {
    if (!projectPath) return null
    if (effectiveSelection.kind === 'orchestrator') {
      return buildPreviewKey(projectPath, 'orchestrator')
    }
    if (effectiveSelection.kind === 'session') {
      const sessionId = typeof effectiveSelection.payload === 'string' ? effectiveSelection.payload : null
      if (sessionId) {
        return buildPreviewKey(projectPath, 'session', sessionId)
      }
    }
    return null
  }, [projectPath, effectiveSelection])

  useEffect(() => {
    let cancelled = false
    const loadPrefs = async () => {
      try {
        const prefs = await invoke<{ inline_sidebar_default?: boolean }>(TauriCommands.GetDiffViewPreferences)
        if (cancelled) return
        setInlineDiffDefault(prefs.inline_sidebar_default ?? true)
      } catch (error) {
        logger.error('[RightPanelTabs] Failed to load diff view preferences:', error)
      }
    }
    void loadPrefs()
    return () => { cancelled = true }
  }, [])

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
    beginSplitDrag('right-panel-internal', { orientation: 'row' })
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

  // Determine active tab based on global state
  // For specs, always show info tab regardless of selection
  // For running sessions, fall back to 'changes' if stored tab is 'specs' (specs tab only exists for orchestrator)
  const effectiveIsSpec = typeof isSpecOverride === 'boolean' ? isSpecOverride : isSpec
  const effectiveIsRunningSession = effectiveSelection.kind === 'session' && !effectiveIsSpec
  const activeTab = (effectiveSelection.kind === 'session' && effectiveIsSpec && rightPanelTab !== 'preview')
    ? 'info'
    : (effectiveIsRunningSession && rightPanelTab === 'specs')
      ? 'changes'
      : rightPanelTab

  useEffect(() => {
    if (activeTab !== 'changes' && changesPanelMode !== 'list') {
      setChangesPanelMode('list')
      setActiveChangesFile(null)
    }
  }, [activeTab, changesPanelMode])

  // Get spec sessions for workspace
  const specSessions = allSessions.filter(session => isSpecSession(session.info))

  // Update local focus state when global focus changes
  useEffect(() => {
    setLocalFocus(currentFocus === 'diff')
    if (currentFocus === 'diff') {
      setTimeout(() => {
        diffContainerRef.current?.focus()
      }, 0)
    }
  }, [currentFocus])

  // Keyboard shortcut for focusing Specs tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutForAction(e, KeyboardShortcutAction.FocusSpecsTab, keyboardShortcutConfig, { platform })) {
        if (effectiveSelection.kind === 'orchestrator') {
          e.preventDefault()
          if (activeTab === 'specs') {
            void setRightPanelTab('changes')
          } else {
            void setRightPanelTab('specs')
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveSelection, activeTab, keyboardShortcutConfig, platform, setRightPanelTab])

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
        void setRightPanelTab('specs')
        openSpecInWorkspace(detail.name)
      }
    })

    return () => {
      cleanupSpecCreated()
    }
  }, [effectiveSelection.kind, openSpecInWorkspace, openTabs, setRightPanelTab])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenSpecInOrchestrator, (detail) => {
      if (detail?.sessionName) {
        logger.info('[RightPanelTabs] Received OpenSpecInOrchestrator event for spec:', detail.sessionName)
        setPendingSpecToOpen(detail.sessionName)
        void setRightPanelTab('specs')
      }
    })

    return cleanup
  }, [setRightPanelTab])

  const focusDiffArea = useCallback(() => {
    const sessionKey = effectiveSelection.kind === 'orchestrator' ? 'orchestrator' : effectiveSelection.payload || 'unknown'
    setFocusForSession(sessionKey, 'diff')
    setLocalFocus(true)
    setTimeout(() => {
      diffContainerRef.current?.focus()
    }, 0)
  }, [effectiveSelection, setFocusForSession])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenInlineDiffView, () => {
      void setRightPanelTab('changes')

      // Toggle back to list when review is already open
      if (activeTab === 'changes' && changesPanelMode === 'review') {
        setChangesPanelMode('list')
        setActiveChangesFile(null)
        focusDiffArea()
        return
      }

      setChangesPanelMode('review')
      focusDiffArea()
    })

    return cleanup
  }, [activeTab, changesPanelMode, focusDiffArea, setRightPanelTab])

  // When selection becomes orchestrator and we have a pending spec, open it
  useEffect(() => {
    if (effectiveSelection.kind === 'orchestrator' && pendingSpecToOpen) {
      logger.info('[RightPanelTabs] Orchestrator selected, opening pending spec:', pendingSpecToOpen)
      openSpecInWorkspace(pendingSpecToOpen)
      setPendingSpecToOpen(null)
    }
  }, [effectiveSelection.kind, pendingSpecToOpen, openSpecInWorkspace])

  const handlePanelClick = () => {
    focusDiffArea()
  }

  const handleOpenDiff = useCallback((filePath?: string | null, forceModal?: boolean) => {
    if (forceModal) {
      if (filePath) {
        emitUiEvent(UiEvent.OpenDiffFile, { filePath })
      } else {
        emitUiEvent(UiEvent.OpenDiffView)
      }
      return
    }

    if (filePath) {
      emitUiEvent(UiEvent.OpenDiffFile, { filePath })
      return
    }

    // When inline diffs are preferred, jump into inline review instead of modal
    if (inlineDiffDefault ?? true) {
      void setRightPanelTab('changes')
      setChangesPanelMode('review')
      focusDiffArea()
      return
    }

    emitUiEvent(UiEvent.OpenDiffView)
  }, [focusDiffArea, inlineDiffDefault, setChangesPanelMode, setRightPanelTab])

  // Note: removed Cmd+D toggle to reserve shortcut for New Spec

  // Unified header with tabs
  const isCommander = effectiveSelection.kind === 'orchestrator'
  const isRunningSession = effectiveSelection.kind === 'session' && !effectiveIsSpec
  const showChangesTab = isCommander || isRunningSession
  const showInfoTab = effectiveSelection.kind === 'session' && effectiveIsSpec
  const showSpecTab = isRunningSession
  const showHistoryTab = isCommander || isRunningSession
  const showSpecsTab = isCommander
  const showPreviewTab = isCommander || isRunningSession
  const tabsPresent = showChangesTab || showInfoTab || showSpecTab || showHistoryTab || showSpecsTab || showPreviewTab
  // Enable split mode when viewing Changes for normal running sessions
  const useSplitMode = isRunningSession && activeTab === 'changes'
  const isInlineReviewing = (isCommander || isRunningSession)
    && activeTab === 'changes'
    && changesPanelMode === 'review'
    && inlineHasFiles

  const handleReformatToggle = useCallback((value: boolean) => {
    setReformatSidebarEnabled(value)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('schaltwerk:inlineReformatSidebar', value ? 'true' : 'false')
    }
    if (isInlineReviewing) {
      onInlineReviewModeChange?.(true, { reformatSidebar: value })
    }
  }, [isInlineReviewing, onInlineReviewModeChange])

  useEffect(() => {
    onInlineReviewModeChange?.(
      isInlineReviewing,
      { reformatSidebar: reformatSidebarEnabled, hasFiles: inlineHasFiles },
    )
  }, [isInlineReviewing, onInlineReviewModeChange, reformatSidebarEnabled, inlineHasFiles])

  return (
    <div
      ref={diffContainerRef}
      tabIndex={-1}
      data-testid="right-panel-container"
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
          showPreviewTab={showPreviewTab}
          onSelectTab={tab => { void setRightPanelTab(tab) }}
        />
      )}

      <div className={`h-[2px] flex-shrink-0 ${localFocus && !isDragging
        ? 'bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent'
        : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
        }`} />

      {/* Body: split mode for running sessions; tabbed mode otherwise */}
      <div className="flex-1 overflow-hidden relative">
        {useSplitMode ? (
          isInlineReviewing ? (
            <SimpleDiffPanel
              mode={changesPanelMode}
              onModeChange={setChangesPanelMode}
              activeFile={activeChangesFile}
              onActiveFileChange={setActiveChangesFile}
              sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
              isCommander={effectiveSelection.kind === 'orchestrator'}
              onOpenDiff={handleOpenDiff}
              onInlinePreferenceChange={setInlineDiffDefault}
              reformatSidebarEnabled={reformatSidebarEnabled}
              onInlineLayoutPreferenceChange={handleReformatToggle}
              onHasFilesChange={setInlineHasFiles}
            />
          ) : (
            <Split
              data-testid="right-split"
              className="h-full flex flex-col"
              sizes={[58, 42]}
              minSize={[140, 120]}
              gutterSize={SPLIT_GUTTER_SIZE}
              direction="vertical"
              onDragStart={handleInternalSplitDragStart}
              onDragEnd={handleInternalSplitDragEnd}
            >
              {/* Top: Changes */}
              <div className="min-h-[120px] overflow-hidden">
                <SimpleDiffPanel
                  mode={changesPanelMode}
                  onModeChange={setChangesPanelMode}
                  activeFile={activeChangesFile}
                  onActiveFileChange={setActiveChangesFile}
                  sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
                  isCommander={effectiveSelection.kind === 'orchestrator'}
                  onOpenDiff={handleOpenDiff}
                  onInlinePreferenceChange={setInlineDiffDefault}
                  reformatSidebarEnabled={reformatSidebarEnabled}
                  onInlineLayoutPreferenceChange={handleReformatToggle}
                  onHasFilesChange={setInlineHasFiles}
                />
              </div>
              {/* Bottom: Spec content with copy bar */}
              <div className="min-h-[120px] overflow-hidden flex flex-col">
                {effectiveSelection.kind === 'session' && (
                  <>
                    <CopyContextBar sessionName={effectiveSelection.payload!} />
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
          )
        ) : (
          <div className="absolute inset-0" key={activeTab}>
            {activeTab === 'preview' ? (
              previewKey ? (
                <WebPreviewPanel previewKey={previewKey} isResizing={isDragging} />
              ) : null
            ) : activeTab === 'changes' ? (
              <SimpleDiffPanel
                mode={changesPanelMode}
                onModeChange={setChangesPanelMode}
                activeFile={activeChangesFile}
                onActiveFileChange={setActiveChangesFile}
                sessionNameOverride={effectiveSelection.kind === 'session' ? (effectiveSelection.payload as string) : undefined}
                isCommander={effectiveSelection.kind === 'orchestrator'}
                onOpenDiff={handleOpenDiff}
                onInlinePreferenceChange={setInlineDiffDefault}
                reformatSidebarEnabled={reformatSidebarEnabled}
                onInlineLayoutPreferenceChange={handleReformatToggle}
                onHasFilesChange={setInlineHasFiles}
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
                  mode={changesPanelMode}
                  onModeChange={setChangesPanelMode}
                  activeFile={activeChangesFile}
                  onActiveFileChange={setActiveChangesFile}
                  sessionNameOverride={undefined}
                  isCommander={true}
                  onOpenDiff={handleOpenDiff}
                  onInlinePreferenceChange={setInlineDiffDefault}
                  reformatSidebarEnabled={reformatSidebarEnabled}
                  onInlineLayoutPreferenceChange={handleReformatToggle}
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
