import { useState, useEffect, useLayoutEffect, useRef, useCallback, useEffectEvent, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import clsx from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useAtomValue } from 'jotai'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { EventPayloadMap, GitOperationPayload } from '../../common/events'
import { useSelection } from '../../hooks/useSelection'
import { useSessions } from '../../hooks/useSessions'
import { captureSelectionSnapshot, SelectionMemoryEntry } from '../../utils/selectionMemory'
import { computeSelectionCandidate } from '../../utils/selectionPostMerge'
import { ConvertToSpecConfirmation } from '../modals/ConvertToSpecConfirmation'
import { FilterMode, FILTER_MODES } from '../../types/sessionFilters'
import { calculateFilterCounts, mapSessionUiState, isReviewed, isSpec } from '../../utils/sessionFilters'
import { theme } from '../../common/theme'
import { groupSessionsByVersion, selectBestVersionAndCleanup, SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { SessionVersionGroup } from './SessionVersionGroup'
import { CollapsedSidebarRail } from './CollapsedSidebarRail'
import { PromoteVersionConfirmation } from '../modals/PromoteVersionConfirmation'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'
import { MergeSessionModal } from '../modals/MergeSessionModal'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { VscRefresh, VscCode, VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc'
import { IconButton } from '../common/IconButton'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { runSpecRefineWithOrchestrator } from '../../utils/specRefine'
import { AGENT_TYPES, AgentType, EnrichedSession } from '../../types/session'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useRun } from '../../contexts/RunContext'
import { useModal } from '../../contexts/ModalContext'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'
import { projectPathAtom } from '../../store/atoms/project'
import { useSessionMergeShortcut } from '../../hooks/useSessionMergeShortcut'
import { DEFAULT_AGENT } from '../../constants/agents'

// Removed legacy terminal-stuck idle handling; we rely on last-edited timestamps only

interface SidebarProps {
    isDiffViewerOpen?: boolean
    openTabs?: Array<{projectPath: string, projectName: string}>
    onSelectPrevProject?: () => void
    onSelectNextProject?: () => void
    isCollapsed?: boolean
    onExpandRequest?: () => void
    onToggleSidebar?: () => void
}

const flattenGroupedSessions = (sessionsToFlatten: EnrichedSession[]): EnrichedSession[] => {
    const sessionGroups = groupSessionsByVersion(sessionsToFlatten)
    const flattenedSessions: EnrichedSession[] = []
    
    for (const group of sessionGroups) {
        for (const version of group.versions) {
            flattenedSessions.push(version.session)
        }
    }
    
    return flattenedSessions
}

export function Sidebar({ isDiffViewerOpen, openTabs = [], onSelectPrevProject, onSelectNextProject, isCollapsed = false, onExpandRequest, onToggleSidebar }: SidebarProps) {
    const { selection, setSelection, terminals, clearTerminalTracking } = useSelection()
    const projectPath = useAtomValue(projectPathAtom)
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const { isSessionRunning } = useRun()
    const { isAnyModalOpen } = useModal()
    const github = useGithubIntegrationContext()
    const { 
        sessions,
        allSessions,
        loading,
        filterMode,
        searchQuery,
        isSearchVisible,
        setFilterMode,
        setSearchQuery,
        setIsSearchVisible,
        reloadSessions,
        optimisticallyConvertSessionToSpec,
        mergeDialogState,
        openMergeDialog,
        closeMergeDialog,
        confirmMerge,
        getMergeStatus,
        autoCancelAfterMerge,
        updateAutoCancelAfterMerge,
        beginSessionMutation,
        endSessionMutation,
        isSessionMutating,
    } = useSessions()
    const { isResetting, resettingSelection, resetSession, switchModel } = useSessionManagement()
    const { getOrchestratorAgentType, getOrchestratorSkipPermissions } = useClaudeSession()

    // Get dynamic shortcut for Orchestrator
    const orchestratorShortcut = useShortcutDisplay(KeyboardShortcutAction.SwitchToOrchestrator)

    const normalizeAgentType = useCallback((value: string | AgentType | undefined | null): AgentType => {
        if (value && AGENT_TYPES.includes(value as AgentType)) {
            return value as AgentType
        }
        return DEFAULT_AGENT
    }, [])

    const [sessionsWithNotifications, setSessionsWithNotifications] = useState<Set<string>>(new Set())
    const [orchestratorBranch, setOrchestratorBranch] = useState<string>("main")
    const inlineDiffDefault = useAtomValue(inlineSidebarDefaultPreferenceAtom)
    const [isMarkReadyCoolingDown, setIsMarkReadyCoolingDown] = useState(false)
    const markReadyCooldownRef = useRef(false)
    const markReadyCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const MARK_READY_COOLDOWN_MS = 250

    const engageMarkReadyCooldown = useCallback((reason: string) => {
        if (!markReadyCooldownRef.current) {
            logger.debug(`[Sidebar] Entering mark-ready cooldown (reason: ${reason})`)
        } else {
            logger.debug(`[Sidebar] Mark-ready cooldown refreshed (reason: ${reason})`)
        }
        markReadyCooldownRef.current = true
        setIsMarkReadyCoolingDown(true)
        if (markReadyCooldownTimerRef.current) {
            clearTimeout(markReadyCooldownTimerRef.current)
            markReadyCooldownTimerRef.current = null
        }
    }, [])

    const scheduleMarkReadyCooldownRelease = useCallback((source: string) => {
        if (markReadyCooldownTimerRef.current) {
            clearTimeout(markReadyCooldownTimerRef.current)
        }
        markReadyCooldownTimerRef.current = setTimeout(() => {
            markReadyCooldownRef.current = false
            setIsMarkReadyCoolingDown(false)
            markReadyCooldownTimerRef.current = null
            logger.debug(`[Sidebar] Mark-ready cooldown released (source: ${source})`)
        }, MARK_READY_COOLDOWN_MS)
    }, [])

    const cancelMarkReadyCooldown = useCallback(() => {
        if (markReadyCooldownTimerRef.current) {
            clearTimeout(markReadyCooldownTimerRef.current)
            markReadyCooldownTimerRef.current = null
        }
        if (markReadyCooldownRef.current) {
            logger.debug('[Sidebar] Mark-ready cooldown cancelled (cleanup)')
        }
        markReadyCooldownRef.current = false
        setIsMarkReadyCoolingDown(false)
    }, [])
    const fetchOrchestratorBranch = useEffectEvent(async () => {
        try {
            const branch = await invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: null })
            setOrchestratorBranch(branch || "main")
        } catch (error) {
            logger.warn('Failed to get current branch, defaulting to main:', error)
            setOrchestratorBranch("main")
        }
    })
    const [keyboardNavigatedFilter, setKeyboardNavigatedFilter] = useState<FilterMode | null>(null)
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState<{ open: boolean; initialAgentType?: AgentType; initialSkipPermissions?: boolean; targetSessionId?: string | null }>({ open: false })
    const [switchModelSessionId, setSwitchModelSessionId] = useState<string | null>(null)
    const orchestratorResetting = resettingSelection?.kind === 'orchestrator'
    const orchestratorRunning = isSessionRunning('orchestrator')
    const leftSidebarShortcut = useShortcutDisplay(KeyboardShortcutAction.ToggleLeftSidebar)

    const [mergeCommitDrafts, setMergeCommitDrafts] = useState<Record<string, string>>({})
    const getCommitDraftForSession = useCallback(
        (sessionId: string) => mergeCommitDrafts[sessionId],
        [mergeCommitDrafts],
    )
    const { handleMergeShortcut, isSessionMerging } = useSessionMergeShortcut({
        getCommitDraftForSession,
    })

    const handleMergeSession = useCallback(
        (sessionId: string) => {
            if (isSessionMerging(sessionId)) return
            void openMergeDialog(sessionId)
        },
        [isSessionMerging, openMergeDialog]
    )

    const [convertToSpecModal, setConvertToDraftModal] = useState<{ 
        open: boolean; 
        sessionName: string; 
        sessionDisplayName?: string;
        hasUncommitted: boolean 
    }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
    
    const [promoteVersionModal, setPromoteVersionModal] = useState<{
        open: boolean
        versionGroup: SessionVersionGroupType | null
        selectedSessionId: string
    }>({
        open: false,
        versionGroup: null,
        selectedSessionId: ''
    })
    const activeMergeSessionId = mergeDialogState.sessionName
    const activeMergeCommitDraft = activeMergeSessionId ? mergeCommitDrafts[activeMergeSessionId] ?? '' : ''

    const updateActiveMergeCommitDraft = useCallback(
        (value: string) => {
            if (!activeMergeSessionId) {
                return
            }
            setMergeCommitDrafts(prev => {
                if (!value) {
                    if (!(activeMergeSessionId in prev)) {
                        return prev
                    }
                    const { [activeMergeSessionId]: _removed, ...rest } = prev
                    return rest
                }
                if (prev[activeMergeSessionId] === value) {
                    return prev
                }
                return { ...prev, [activeMergeSessionId]: value }
            })
        },
        [activeMergeSessionId]
    )
    const sidebarRef = useRef<HTMLDivElement>(null)
    const sessionListRef = useRef<HTMLDivElement>(null)
    const sessionScrollTopRef = useRef(0)
    const isProjectSwitching = useRef(false)
    const previousProjectPathRef = useRef<string | null>(null)
    const previousFilterModeRef = useRef<FilterMode>(filterMode)

    const selectionMemoryRef = useRef<Map<string, Record<FilterMode, SelectionMemoryEntry>>>(new Map())

    const ensureProjectMemory = useCallback(() => {
      const key = projectPath || '__default__';
      if (!selectionMemoryRef.current.has(key)) {
        selectionMemoryRef.current.set(key, {
          [FilterMode.All]: { lastSelection: null, lastSessions: [] },
          [FilterMode.Spec]: { lastSelection: null, lastSessions: [] },
          [FilterMode.Running]: { lastSelection: null, lastSessions: [] },
          [FilterMode.Reviewed]: { lastSelection: null, lastSessions: [] },
        });
      }
      return selectionMemoryRef.current.get(key)!;
    }, [projectPath]);

    const flattenedSessions = useMemo(() => flattenGroupedSessions(sessions), [sessions])

    useEffect(() => {
        if (previousProjectPathRef.current !== null && previousProjectPathRef.current !== projectPath) {
            isProjectSwitching.current = true
            previousFilterModeRef.current = filterMode
        }
        previousProjectPathRef.current = projectPath
    }, [projectPath, filterMode]);

    useEffect(() => {
        let unsubscribe: (() => void) | null = null
        const attach = async () => {
            unsubscribe = await listenUiEvent(UiEvent.ProjectSwitchComplete, () => {
                isProjectSwitching.current = false
            })
        }
        void attach()
        return () => {
            unsubscribe?.()
        }
    }, []);

    const reloadSessionsAndRefreshIdle = useCallback(async () => {
        await reloadSessions()
    }, [reloadSessions]);

    const createSafeUnlistener = useCallback((fn: UnlistenFn): UnlistenFn => {
        let called = false
        return () => {
            if (called) return
            called = true
            try {
                void Promise.resolve(fn()).catch(error => {
                    logger.warn('Failed to unlisten sidebar event', error)
                })
            } catch (error) {
                logger.warn('Failed to unlisten sidebar event', error)
            }
        }
    }, [])
    
    // Maintain per-filter selection memory and choose the next best session when visibility changes
    useEffect(() => {
        if (isProjectSwitching.current) {
            // Allow refocus even if the project switch completion event is delayed
            isProjectSwitching.current = false
        }

        const allSessionsSnapshot = allSessions.length > 0 ? allSessions : latestSessionsRef.current

        const memory = ensureProjectMemory();
        const entry = memory[filterMode];

        const visibleSessions = sessions
        const visibleIds = new Set(visibleSessions.map(s => s.info.session_id))
        const currentSelectionId = selection.kind === 'session' ? (selection.payload ?? null) : null

        const { previousSessions } = captureSelectionSnapshot(entry, visibleSessions)

        const removalCandidateFromEvent = lastRemovedSessionRef.current
        const mergedCandidate = lastMergedReviewedSessionRef.current

        const mergedSessionInfo = mergedCandidate
            ? allSessionsSnapshot.find(s => s.info.session_id === mergedCandidate)
            : undefined
        const mergedStillReviewed = mergedSessionInfo ? isReviewed(mergedSessionInfo.info) : false

        const shouldAdvanceFromMerged = Boolean(
            mergedCandidate &&
            currentSelectionId === mergedCandidate &&
            !mergedStillReviewed
        )

        if (mergedCandidate && (!currentSelectionId || currentSelectionId !== mergedCandidate)) {
            lastMergedReviewedSessionRef.current = null
        }

        const removalCandidateSession = removalCandidateFromEvent
            ? allSessionsSnapshot.find(s => s.info.session_id === removalCandidateFromEvent)
            : undefined
        const wasReviewedSession = removalCandidateSession ? isReviewed(removalCandidateSession.info) : false
        const shouldPreserveForReviewedRemoval = Boolean(wasReviewedSession && removalCandidateFromEvent && filterMode !== FilterMode.Reviewed)

        const filterModeChanged = previousFilterModeRef.current !== filterMode
        previousFilterModeRef.current = filterMode

        const currentSelectionSession = currentSelectionId
            ? allSessionsSnapshot.find(s => s.info.session_id === currentSelectionId)
            : undefined
        const currentSessionMovedToReviewed = Boolean(
            !filterModeChanged &&
            currentSelectionId &&
            !visibleIds.has(currentSelectionId) &&
            currentSelectionSession &&
            isReviewed(currentSelectionSession.info) &&
            filterMode === FilterMode.Running
        )

        const effectiveRemovalCandidate = currentSessionMovedToReviewed && currentSelectionId
            ? currentSelectionId
            : removalCandidateFromEvent

        if (selection.kind === 'orchestrator') {
            entry.lastSelection = null
            if (!effectiveRemovalCandidate && !shouldAdvanceFromMerged) {
                return
            }
        }

        if (visibleSessions.length === 0) {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
            if (removalCandidateFromEvent) {
                lastRemovedSessionRef.current = null
            }
            if (shouldAdvanceFromMerged) {
                lastMergedReviewedSessionRef.current = null
            }
            return
        }

        if (selection.kind === 'session' && currentSelectionId && visibleIds.has(currentSelectionId) && !shouldAdvanceFromMerged) {
            entry.lastSelection = currentSelectionId
            if (lastRemovedSessionRef.current) {
                lastRemovedSessionRef.current = null
            }
            return
        }

        const rememberedId = entry.lastSelection
        const candidateId = computeSelectionCandidate({
            currentSelectionId,
            visibleSessions,
            previousSessions,
            rememberedId,
            removalCandidate: effectiveRemovalCandidate,
            mergedCandidate,
            shouldAdvanceFromMerged,
            shouldPreserveForReviewedRemoval,
            allSessions: allSessionsSnapshot
        })

        if (candidateId) {
            entry.lastSelection = candidateId
            if (candidateId !== currentSelectionId) {
                const targetSession = visibleSessions.find(s => s.info.session_id === candidateId)
                    ?? allSessionsSnapshot.find(s => s.info.session_id === candidateId)
                if (targetSession) {
                    void setSelection({
                        kind: 'session',
                        payload: candidateId,
                        worktreePath: targetSession.info.worktree_path,
                        sessionState: mapSessionUiState(targetSession.info)
                    }, false, false)
                }
            }
        } else {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
        }

        if (removalCandidateFromEvent) {
            lastRemovedSessionRef.current = null
        }
        if (shouldAdvanceFromMerged) {
            lastMergedReviewedSessionRef.current = null
        }
    }, [sessions, selection, filterMode, ensureProjectMemory, allSessions, setSelection])

    useEffect(() => { void fetchOrchestratorBranch() }, [])

    useEffect(() => {
        if (selection.kind !== 'orchestrator') return
        void fetchOrchestratorBranch()
    }, [selection])

    useEffect(() => {
        let unlistenProjectReady: UnlistenFn | null = null
        let unlistenFileChanges: UnlistenFn | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.ProjectReady, () => { void fetchOrchestratorBranch() })
                unlistenProjectReady = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for project ready events:', error)
            }

            try {
                const unlisten = await listenEvent(SchaltEvent.FileChanges, event => {
                    if (event.session_name === ORCHESTRATOR_SESSION_NAME) {
                        setOrchestratorBranch(event.branch_info.current_branch || 'HEAD')
                    }
                })
                unlistenFileChanges = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for orchestrator file changes:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenProjectReady) {
                unlistenProjectReady()
            }
            if (unlistenFileChanges) {
                unlistenFileChanges()
            }
        }
    }, [createSafeUnlistener])

    const handleSelectOrchestrator = useCallback(async () => {
        await setSelection({ kind: 'orchestrator' }, false, true) // User clicked - intentional
    }, [setSelection])
    const handleSelectSession = async (index: number) => {
        const session = flattenedSessions[index]
        if (session) {
            const s = session.info
            
            // Clear follow-up message notification when user selects the session
            setSessionsWithNotifications(prev => {
                const updated = new Set(prev)
                updated.delete(s.session_id)
                return updated
            })
            
            // Directly set selection to minimize latency in switching
            await setSelection({
                kind: 'session',
                payload: s.session_id,
                worktreePath: s.worktree_path,
                sessionState: mapSessionUiState(s)
            }, false, true) // User clicked - intentional
        }
    }

    const handleCancelSelectedSession = (immediate: boolean) => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession) {
                const sessionDisplayName = getSessionDisplayName(selectedSession.info)
                // Check if it's a spec
                if (isSpec(selectedSession.info)) {
                    // For specs, always show confirmation dialog (ignore immediate flag)
                    emitUiEvent(UiEvent.SessionAction, {
                        action: 'delete-spec',
                        sessionId: selectedSession.info.session_id,
                        sessionName: selectedSession.info.session_id,
                        sessionDisplayName,
                        branch: selectedSession.info.branch,
                        hasUncommittedChanges: false,
                    })
                } else {
                    // For regular sessions, handle as before
                    if (immediate) {
                        // immediate cancel without modal
                        emitUiEvent(UiEvent.SessionAction, {
                            action: 'cancel-immediate',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false,
                        })
                    } else {
                        emitUiEvent(UiEvent.SessionAction, {
                            action: 'cancel',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false,
                        })
                    }
                }
            }
        }
    }

    const selectPrev = async () => {
        if (sessions.length === 0) return

        if (selection.kind === 'session') {
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            if (currentIndex <= 0) {
                await handleSelectOrchestrator()
                return
            }
            await handleSelectSession(currentIndex - 1)
        }
    }

    const selectNext = async () => {
        if (sessions.length === 0) return

        if (selection.kind === 'orchestrator') {
            await handleSelectSession(0)
            return
        }

        if (selection.kind === 'session') {
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, flattenedSessions.length - 1)
            if (nextIndex != currentIndex) {
                await handleSelectSession(nextIndex)
            }
        }
    }

    const handleMarkReady = useCallback(async (sessionId: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreMarkSessionReady, {
                name: sessionId
            })
            await reloadSessionsAndRefreshIdle()
        } catch (error) {
            logger.error('Failed to mark session as reviewed:', error)
            alert(`Failed to mark session as reviewed: ${error}`)
        }
    }, [reloadSessionsAndRefreshIdle])

    const triggerMarkReady = useCallback(async (sessionId: string) => {
        if (markReadyCooldownRef.current) {
            logger.debug(`[Sidebar] Skipping mark-ready for ${sessionId} (cooldown active)`)
            return
        }

        logger.debug(`[Sidebar] Triggering mark-ready for ${sessionId}`)
        engageMarkReadyCooldown('mark-ready-trigger')
        try {
            await handleMarkReady(sessionId)
        } catch (error) {
            logger.error('Failed to mark session ready during cooldown window:', error)
        } finally {
            scheduleMarkReadyCooldownRelease('mark-ready-complete')
        }
    }, [engageMarkReadyCooldown, scheduleMarkReadyCooldownRelease, handleMarkReady])

    const handleMarkSelectedSessionReady = useCallback(async () => {
        if (selection.kind !== 'session') return

        const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
        if (!selectedSession) return

        const sessionInfo = selectedSession.info

        if (isReviewed(sessionInfo)) {
            if (markReadyCooldownRef.current) {
                logger.debug(`[Sidebar] Skipping unmark-ready for ${sessionInfo.session_id} (cooldown active)`)
                return
            }

            logger.debug(`[Sidebar] Triggering unmark-ready for ${sessionInfo.session_id}`)
            engageMarkReadyCooldown('unmark-ready-trigger')
            try {
                await invoke(TauriCommands.SchaltwerkCoreUnmarkSessionReady, { name: sessionInfo.session_id })
                await reloadSessionsAndRefreshIdle()
            } catch (error) {
                logger.error('Failed to unmark reviewed session via keyboard:', error)
            } finally {
                scheduleMarkReadyCooldownRelease('unmark-ready-complete')
            }
            return
        }

        if (isSpec(sessionInfo)) {
            logger.warn(`Cannot mark spec "${sessionInfo.session_id}" as reviewed. Specs must be started as agents first.`)
            return
        }

        await triggerMarkReady(sessionInfo.session_id)
    }, [
        selection,
        sessions,
        triggerMarkReady,
        reloadSessionsAndRefreshIdle,
        engageMarkReadyCooldown,
        scheduleMarkReadyCooldownRelease
    ])

    const handleSpecSelectedSession = () => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !isSpec(selectedSession.info) && !isReviewed(selectedSession.info)) {
                // Allow converting running sessions to specs only, not reviewed or spec sessions
                setConvertToDraftModal({
                    open: true,
                    sessionName: selectedSession.info.session_id,
                    sessionDisplayName: getSessionDisplayName(selectedSession.info),
                    hasUncommitted: selectedSession.info.has_uncommitted_changes || false
                })
            }
        }
    }

    const handleSelectBestVersion = (groupBaseName: string, selectedSessionId: string) => {
        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g => g.baseName === groupBaseName)
        
        if (!targetGroup) {
            logger.error(`Version group ${groupBaseName} not found`)
            return
        }

        // Check if user has opted out of confirmation for this project
        const noConfirmKey = `promote-version-no-confirm-${groupBaseName}`
        const skipConfirmation = localStorage.getItem(noConfirmKey) === 'true'
        
        if (skipConfirmation) {
            // Execute directly without confirmation
            void executeVersionPromotion(targetGroup, selectedSessionId)
        } else {
            // Show confirmation modal
            setPromoteVersionModal({
                open: true,
                versionGroup: targetGroup,
                selectedSessionId
            })
        }
    }

    const executeVersionPromotion = async (targetGroup: SessionVersionGroupType, selectedSessionId: string) => {
        try {
            await selectBestVersionAndCleanup(targetGroup, selectedSessionId, invoke, reloadSessionsAndRefreshIdle)
        } catch (error) {
            logger.error('Failed to select best version:', error)
            alert(`Failed to select best version: ${error}`)
        }
    }

    const handlePromoteSelectedVersion = () => {
        if (selection.kind !== 'session' || !selection.payload) {
            return // No session selected
        }

        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g => 
            g.isVersionGroup && g.versions.some(v => v.session.info.session_id === selection.payload)
        )
        
        if (!targetGroup) {
            return // Selected session is not within a version group
        }

        handleSelectBestVersion(targetGroup.baseName, selection.payload)
    }

    // Project switching functions
    const handleSelectPrevProject = () => {
        if (onSelectPrevProject && openTabs.length > 1) {
            onSelectPrevProject()
        }
    }

    const handleSelectNextProject = () => {
        if (onSelectNextProject && openTabs.length > 1) {
            onSelectNextProject()
        }
    }

    const handleNavigateToPrevFilter = () => {
        const currentIndex = FILTER_MODES.indexOf(filterMode)
        const prevIndex = currentIndex === 0 ? FILTER_MODES.length - 1 : currentIndex - 1
        const nextFilter = FILTER_MODES[prevIndex]

        setKeyboardNavigatedFilter(nextFilter)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setKeyboardNavigatedFilter(null)
            })
        })

        setFilterMode(nextFilter)
    }

    const handleNavigateToNextFilter = () => {
        const currentIndex = FILTER_MODES.indexOf(filterMode)
        const nextIndex = (currentIndex + 1) % FILTER_MODES.length
        const nextFilter = FILTER_MODES[nextIndex]

        setKeyboardNavigatedFilter(nextFilter)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setKeyboardNavigatedFilter(null)
            })
        })

        setFilterMode(nextFilter)
    }

    const findSessionById = useCallback((sessionId?: string | null) => {
        if (!sessionId) return null
        return sessions.find(s => s.info.session_id === sessionId)
            || allSessions.find(s => s.info.session_id === sessionId)
            || null
    }, [sessions, allSessions])

    const getSelectedSessionState = useCallback((): ('spec' | 'running' | 'reviewed') | null => {
        if (selection.kind !== 'session') return null
        if (selection.sessionState) return selection.sessionState
        const session = findSessionById(selection.payload || null)
        return session ? mapSessionUiState(session.info) : null
    }, [selection, findSessionById])

    const handleResetSelectionShortcut = useCallback(() => {
        if (isResetting) return
        if (isAnyModalOpen()) return

        if (selection.kind === 'orchestrator') {
            void resetSession({ kind: 'orchestrator' }, terminals)
            return
        }

        if (selection.kind !== 'session' || !selection.payload) return

        const state = getSelectedSessionState()
        if (state !== 'running' && state !== 'reviewed') return

        void resetSession({ kind: 'session', payload: selection.payload }, terminals)
    }, [isResetting, isAnyModalOpen, selection, resetSession, terminals, getSelectedSessionState])

    const handleOpenSwitchModelShortcut = useCallback(() => {
        if (isAnyModalOpen()) return

        if (selection.kind === 'orchestrator') {
            setSwitchModelSessionId(null)
            void Promise.all([getOrchestratorAgentType(), getOrchestratorSkipPermissions()]).then(([initialAgentType, initialSkipPermissions]) => {
                setSwitchOrchestratorModal({
                    open: true,
                    initialAgentType: normalizeAgentType(initialAgentType),
                    initialSkipPermissions,
                    targetSessionId: null
                })
            })
            return
        }

        if (selection.kind !== 'session' || !selection.payload) return

        const state = getSelectedSessionState()
        if (state !== 'running') return

        setSwitchModelSessionId(selection.payload)
        const session = sessions.find(s => s.info.session_id === selection.payload)
        const initialAgentType = normalizeAgentType(session?.info.original_agent_type)
        const initialSkipPermissions = Boolean(session?.info && (session.info as { original_skip_permissions?: boolean }).original_skip_permissions)
        setSwitchOrchestratorModal({ open: true, initialAgentType, initialSkipPermissions, targetSessionId: selection.payload })
    }, [
        isAnyModalOpen,
        selection,
        getSelectedSessionState,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        getOrchestratorAgentType,
        getOrchestratorSkipPermissions,
        sessions,
        normalizeAgentType
    ])

    const handleCreatePullRequestShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !session.info.ready_to_merge) return
        if (!github.canCreatePr) return
        emitUiEvent(UiEvent.CreatePullRequest, { sessionId: selection.payload })
    }, [isAnyModalOpen, selection, sessions, github.canCreatePr])

    const runRefineSpecFlow = useCallback((sessionId: string, displayName?: string) => {
        void runSpecRefineWithOrchestrator({
            sessionId,
            displayName,
            selectOrchestrator: () => setSelection({ kind: 'orchestrator' }, false, true),
            logContext: '[Sidebar]',
        })
    }, [setSelection])

    const handleRefineSpecShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !isSpec(session.info)) return
        runRefineSpecFlow(selection.payload, getSessionDisplayName(session.info))
    }, [isAnyModalOpen, selection, sessions, runRefineSpecFlow])

    useKeyboardShortcuts({
        onSelectOrchestrator: () => { void handleSelectOrchestrator() },
        onSelectSession: (index) => { void handleSelectSession(index) },
        onCancelSelectedSession: handleCancelSelectedSession,
        onMarkSelectedSessionReady: () => { void handleMarkSelectedSessionReady() },
        onRefineSpec: handleRefineSpecShortcut,
        onSpecSession: handleSpecSelectedSession,
        onPromoteSelectedVersion: () => { void handlePromoteSelectedVersion() },
        sessionCount: sessions.length,
        onSelectPrevSession: () => { void selectPrev() },
        onSelectNextSession: () => { void selectNext() },
        onFocusSidebar: () => {
            setCurrentFocus('sidebar')
            // Focus the first button in the sidebar
            setTimeout(() => {
                const button = sidebarRef.current?.querySelector('button')
                if (button instanceof HTMLElement) {
                    button.focus()
                }
            }, 50)
        },
        onFocusClaude: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'claude')
            // Set flag to indicate this is from Cmd+T shortcut - should scroll to bottom
            window.__cmdTPressed = true
            setCurrentFocus('claude')
            // This will trigger TerminalGrid's currentFocus effect immediately
        },
        onOpenDiffViewer: () => {
            if (selection.kind !== 'session' && selection.kind !== 'orchestrator') return
            if (inlineDiffDefault) {
                emitUiEvent(UiEvent.OpenInlineDiffView)
            } else {
                emitUiEvent(UiEvent.OpenDiffView)
            }
        },
        onFocusTerminal: () => {
            // Don't dispatch focus events if any modal is open
            if (isAnyModalOpen()) {
                return
            }
            
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
            emitUiEvent(UiEvent.FocusTerminal)
        },
        onSelectPrevProject: handleSelectPrevProject,
        onSelectNextProject: handleSelectNextProject,
        onNavigateToPrevFilter: handleNavigateToPrevFilter,
        onNavigateToNextFilter: handleNavigateToNextFilter,
        onResetSelection: handleResetSelectionShortcut,
        onOpenSwitchModel: handleOpenSwitchModelShortcut,
        onOpenMergeModal: () => { void handleMergeShortcut() },
        onCreatePullRequest: handleCreatePullRequestShortcut,
        isDiffViewerOpen,
        isModalOpen: isAnyModalOpen()
    })

    // Sessions are now managed by Jotai sessions atoms with integrated sorting/filtering
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        let unsubscribe: (() => void) | null = null
        const attach = async () => {
            unsubscribe = await listenUiEvent(UiEvent.GlobalMarkReadyShortcut, () => { void handleMarkSelectedSessionReady() })
        }
        void attach()
        return () => {
            unsubscribe?.()
        }
    }, [selection, sessions, handleMarkSelectedSessionReady])

    // Selection is now restored by the selection state atoms

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSessionsRef = useRef(allSessions)
    const lastRemovedSessionRef = useRef<string | null>(null)
    const lastMergedReviewedSessionRef = useRef<string | null>(null)

    useEffect(() => { latestSessionsRef.current = allSessions }, [allSessions])

    // Scroll selected session into view when selection changes
    useLayoutEffect(() => {
        if (selection.kind !== 'session') return

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const selectedElement = sidebarRef.current?.querySelector(`[data-session-selected="true"]`)
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest'
                    })
                    if (sessionListRef.current) {
                        sessionScrollTopRef.current = sessionListRef.current.scrollTop
                    }
                }
            })
        })
    }, [selection])

    const handleSessionScroll = useCallback((event: { currentTarget: { scrollTop: number } }) => {
        sessionScrollTopRef.current = event.currentTarget.scrollTop
    }, [])

    useEffect(() => {
        const node = sessionListRef.current
        if (node) {
            node.scrollTop = sessionScrollTopRef.current
        }
    }, [isCollapsed])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let disposed = false
        const unlisteners: UnlistenFn[] = []

        const register = async <E extends SchaltEvent>(
            event: E,
            handler: (payload: EventPayloadMap[E]) => void | Promise<void>
        ) => {
            try {
                const unlisten = await listenEvent(event, async (payload) => {
                    if (!disposed) {
                        await handler(payload)
                    }
                })
                const safeUnlisten = createSafeUnlistener(unlisten)
                if (disposed) {
                    safeUnlisten()
                } else {
                    unlisteners.push(safeUnlisten)
                }
            } catch (e) {
                logger.warn('Failed to attach sidebar event listener', e)
            }
        }

        // Activity and git stats updates are handled by the sessions atoms layer

        void register(SchaltEvent.SessionRemoved, (event) => {
            lastRemovedSessionRef.current = event.session_name
        })

        void register(SchaltEvent.GitOperationCompleted, (event: GitOperationPayload) => {
            if (event?.operation === 'merge') {
                lastMergedReviewedSessionRef.current = event.session_name
            }
        })

        void register(SchaltEvent.FollowUpMessage, (event) => {
            const { session_name, message, message_type } = event

            setSessionsWithNotifications(prev => new Set([...prev, session_name]))

            const session = latestSessionsRef.current.find(s => s.info.session_id === session_name)
            if (session) {
            void setSelection({
                kind: 'session',
                payload: session_name,
                worktreePath: session.info.worktree_path,
                sessionState: mapSessionUiState(session.info)
            }, false, true)
                setFocusForSession(session_name, 'claude')
                setCurrentFocus('claude')
            }

            logger.info(`📬 Follow-up message for ${session_name}: ${message}`)

            if (message_type === 'system') {
                logger.info(`📢 System message for session ${session_name}: ${message}`)
            } else {
                logger.info(`💬 User message for session ${session_name}: ${message}`)
            }
        })

        return () => {
            disposed = true
            unlisteners.forEach(unlisten => {
                try {
                    unlisten()
                } catch (error) {
                    logger.warn('[Sidebar] Failed to remove event listener during cleanup', error)
                }
            })
        }
    }, [setCurrentFocus, setFocusForSession, setSelection, createSafeUnlistener])

    useEffect(() => () => cancelMarkReadyCooldown(), [cancelMarkReadyCooldown])

    // Calculate counts based on all sessions (unaffected by search)
    const { allCount, specsCount, runningCount, reviewedCount } = calculateFilterCounts(allSessions)

    return (
        <div
            ref={sidebarRef}
            className="h-full flex flex-col min-h-0"
            onDoubleClick={() => {
                if (isCollapsed && onExpandRequest) {
                    onExpandRequest()
                }
            }}
        >
            <div className={clsx('flex items-center shrink-0 h-9', isCollapsed ? 'justify-center px-0' : 'justify-between px-2 pt-2')}>
                {!isCollapsed && (
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider ml-1">Agents</span>
                )}
                {onToggleSidebar && (
                    <div className="flex items-center gap-2">
                        {!isCollapsed && leftSidebarShortcut && (
                            <span className="text-[11px] text-slate-500" aria-hidden="true">
                                {leftSidebarShortcut}
                            </span>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onToggleSidebar()
                            }}
                            className={clsx(
                                "h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors",
                                !isCollapsed && "ml-auto"
                            )}
                            title={isCollapsed ? 'Show left sidebar' : 'Hide left sidebar'}
                            aria-label={isCollapsed ? 'Show left sidebar' : 'Hide left sidebar'}
                        >
                            {isCollapsed ? <VscLayoutSidebarLeftOff /> : <VscLayoutSidebarLeft />}
                        </button>
                    </div>
                )}
            </div>

            <div className={clsx('pt-1', isCollapsed ? 'px-1' : 'px-2')}>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { void handleSelectOrchestrator() }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void handleSelectOrchestrator()
                        }
                    }}
                    className={clsx(
                        'w-full text-left py-2 rounded-md mb-1 group border transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-slate-900',
                        isCollapsed ? 'px-0 justify-center flex' : 'px-3',
                        selection.kind === 'orchestrator'
                            ? 'bg-slate-800/60 session-ring session-ring-blue border-transparent'
                            : 'hover:bg-slate-800/30 border-slate-800',
                        orchestratorRunning && selection.kind !== 'orchestrator' &&
                            'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20'
                    )}
                    aria-label="Select orchestrator (⌘1)"
                    aria-pressed={selection.kind === 'orchestrator'}
                    data-onboarding="orchestrator-entry"
                >
                    <div className={clsx('flex items-center w-full', isCollapsed ? 'flex-col justify-center gap-1' : 'justify-between')}>
                        {!isCollapsed && (
                            <>
                                <div className="font-medium text-slate-100 flex items-center gap-2">
                                    orchestrator
                                    {orchestratorRunning && (
                                        <ProgressIndicator size="sm" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-0.5">
                                        <IconButton
                                            icon={<VscCode />}
                                            onClick={() => {
                                                setSwitchModelSessionId(null)
                                                void Promise.all([getOrchestratorAgentType(), getOrchestratorSkipPermissions()]).then(([initialAgentType, initialSkipPermissions]) => {
                                                    setSwitchOrchestratorModal({
                                                        open: true,
                                                        initialAgentType: normalizeAgentType(initialAgentType),
                                                        initialSkipPermissions,
                                                        targetSessionId: null
                                                    })
                                                })
                                            }}
                                            ariaLabel="Switch orchestrator model"
                                            tooltip="Switch model (⌘P)"
                                        />
                                        <IconButton
                                            icon={<VscRefresh />}
                                            onClick={() => {
                                                void (async () => {
                                                    if (selection.kind === 'orchestrator') {
                                                        await resetSession(selection, terminals)
                                                    }
                                                })()
                                            }}
                                            ariaLabel="Reset orchestrator"
                                            tooltip="Reset orchestrator (⌘Y)"
                                            disabled={orchestratorResetting}
                                        />
                                    </div>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                        {orchestratorShortcut || '⌘1'}
                                    </span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">{orchestratorBranch}</span>
                                </div>
                            </>
                        )}
                        {isCollapsed && (
                            <>
                                <div className="text-slate-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                </div>
                                <span className="text-[9px] text-blue-400 font-mono max-w-full truncate">
                                    {(orchestratorBranch === 'main' || orchestratorBranch === 'master') ? 'main' : (orchestratorBranch || 'brch')}
                                </span>
                                {orchestratorRunning && (
                                    <div className="mt-1"><ProgressIndicator size="sm" /></div>
                                )}
                            </>
                        )}
                    </div>
                    {!isCollapsed && (
                        <div className="text-xs text-slate-500">Original repository from which agents are created</div>
                    )}
                </div>
            </div>

            {isCollapsed && (
                <div className="py-1 px-0.5 flex items-center justify-center" aria-hidden="true">
                    <span
                        className="px-1 py-[2px] rounded border"
                        style={{
                            color: theme.colors.text.secondary,
                            borderColor: theme.colors.border.subtle,
                            backgroundColor: theme.colors.background.elevated,
                            fontSize: theme.fontSize.caption,
                            lineHeight: theme.lineHeight.compact,
                            minWidth: '24px',
                            textAlign: 'center',
                        }}
                        title={`Filter: ${filterMode}`}
                    >
                        {filterMode === FilterMode.All && 'ALL'}
                        {filterMode === FilterMode.Spec && 'SPEC'}
                        {filterMode === FilterMode.Running && 'RUN'}
                        {filterMode === FilterMode.Reviewed && 'REV'}
                    </span>
                </div>
            )}

            {!isCollapsed && (
                <div
                    className="h-8 px-3 border-t border-b border-slate-800 text-xs text-slate-300 flex items-center"
                    data-onboarding="session-filter-row"
                >
                    <div className="flex items-center gap-2 w-full">
                        <div className="flex items-center gap-1 ml-auto flex-nowrap overflow-x-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
                            {/* Search Icon */}
                                    <button
                                        onClick={() => {
                                            setIsSearchVisible(true)
                                            // Trigger OpenCode TUI resize workaround for the active context
                                            if (selection.kind === 'session' && selection.payload) {
                                                emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                            } else {
                                                emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                            }
                                            // Generic resize request for all terminals in the active context
                                            try {
                                                if (selection.kind === 'session' && selection.payload) {
                                                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                                } else {
                                                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                                }
                                            } catch (e) {
                                                logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search open)', e)
                                            }
                                        }}
                                className={clsx('px-1 py-0.5 rounded hover:bg-slate-700/50 flex items-center flex-shrink-0',
                                    isSearchVisible ? 'bg-slate-700/50 text-white' : 'text-slate-400 hover:text-white')}
                                title="Search sessions"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                </svg>
                            </button>
                            <button
                                className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                    filterMode === FilterMode.All ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                    keyboardNavigatedFilter === FilterMode.All && '' )}
                                onClick={() => setFilterMode(FilterMode.All)}
                                title="Show all agents"
                            >
                                All <span className="text-slate-400">({allCount})</span>
                            </button>
                            <button
                                className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1',
                                    filterMode === FilterMode.Spec ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                    keyboardNavigatedFilter === FilterMode.Spec && '' )}
                                onClick={() => setFilterMode(FilterMode.Spec)}
                                title="Show spec agents"
                            >
                                Specs <span className="text-slate-400">({specsCount})</span>
                            </button>
                            <button
                                className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                    filterMode === FilterMode.Running ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                    keyboardNavigatedFilter === FilterMode.Running && '' )}
                                onClick={() => setFilterMode(FilterMode.Running)}
                                title="Show running agents"
                            >
                                Running <span className="text-slate-400">({runningCount})</span>
                            </button>
                            <button
                                className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                    filterMode === FilterMode.Reviewed ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                    keyboardNavigatedFilter === FilterMode.Reviewed && '' )}
                                onClick={() => setFilterMode(FilterMode.Reviewed)}
                                title="Show reviewed agents"
                            >
                                Reviewed <span className="text-slate-400">({reviewedCount})</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Search Line - appears below filters when active */}
            {!isCollapsed && isSearchVisible && (
                <div className="h-8 px-3 border-b border-slate-800 bg-slate-900/50 flex items-center">
                    <div className="flex items-center gap-2 w-full">
                        <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                // Each search keystroke nudges OpenCode to repaint correctly for the active context
                                if (selection.kind === 'session' && selection.payload) {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                } else {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                }
                                try {
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                    } else {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                    }
                                } catch (e) {
                                    logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search type)', e)
                                }
                            }}
                            placeholder="Search sessions..."
                            className="flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500"
                            autoFocus
                        />
                        {searchQuery && (
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                                {sessions.length} result{sessions.length !== 1 ? 's' : ''}
                            </span>
                        )}
                        <button
                            onClick={() => {
                                setSearchQuery('')
                                setIsSearchVisible(false)
                                // Also trigger a resize when closing search (layout shifts)
                                if (selection.kind === 'session' && selection.payload) {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                } else {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                }
                                try {
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                    } else {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                    }
                                } catch (e) {
                                    logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search close)', e)
                                }
                            }}
                            className="text-slate-400 hover:text-slate-200 p-0.5"
                            title="Close search"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
            <div
                ref={sessionListRef}
                onScroll={handleSessionScroll}
                className={clsx(
                    'flex-1 min-h-0 overflow-y-auto pt-1',
                    isCollapsed ? 'px-0.5' : 'px-2'
                )}
                data-testid="session-scroll-container"
                data-onboarding="session-list"
            >
                {sessions.length === 0 && !loading ? (
                    <div className="text-center text-slate-500 py-4">No active agents</div>
                ) : (
                    isCollapsed ? (
                        <CollapsedSidebarRail
                            sessions={flattenedSessions}
                            selection={selection}
                            hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                            isSessionRunning={isSessionRunning}
                            onSelect={(index) => { void handleSelectSession(index) }}
                            onExpandRequest={onExpandRequest}
                        />
                    ) : (
                        (() => {
                            const sessionGroups = groupSessionsByVersion(sessions)
                            let globalIndex = 0
                            
                            return sessionGroups.map((group) => {
                                const groupStartIndex = globalIndex
                                globalIndex += group.versions.length
                                
                                return (
                                    <SessionVersionGroup
                                        key={group.baseName}
                                        group={group}
                                        selection={selection}
                                        startIndex={groupStartIndex}

                                        hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                                        onSelect={(index) => {
                                            void handleSelectSession(index)
                                        }}
                                        onMarkReady={(sessionId) => {
                                            if (markReadyCooldownRef.current) {
                                                return
                                            }
                                            void triggerMarkReady(sessionId)
                                        }}
                                        onUnmarkReady={(sessionId) => {
                                            if (markReadyCooldownRef.current) {
                                                return
                                            }

                                            engageMarkReadyCooldown('unmark-ready-click')
                                            void (async () => {
                                                try {
                                                    await invoke(TauriCommands.SchaltwerkCoreUnmarkSessionReady, { name: sessionId })
                                                    await reloadSessionsAndRefreshIdle()
                                                } catch (err) {
                                                    logger.error('Failed to unmark reviewed session:', err)
                                                } finally {
                                                    scheduleMarkReadyCooldownRelease('unmark-ready-click-complete')
                                                }
                                            })()
                                        }}
                                        onCancel={(sessionId, hasUncommitted) => {
                                            const session = sessions.find(s => s.info.session_id === sessionId)
                                            if (session) {
                                                const sessionDisplayName = getSessionDisplayName(session.info)
                                                emitUiEvent(UiEvent.SessionAction, {
                                                    action: 'cancel',
                                                    sessionId,
                                                    sessionName: sessionId,
                                                    sessionDisplayName,
                                                    branch: session.info.branch,
                                                    hasUncommittedChanges: hasUncommitted,
                                                })
                                            }
                                        }}
                                        onConvertToSpec={(sessionId) => {
                                            const session = sessions.find(s => s.info.session_id === sessionId)
                                            if (session) {
                                                // Only allow converting running sessions to specs, not reviewed sessions
                                                if (isReviewed(session.info)) {
                                                    logger.warn(`Cannot convert reviewed session "${sessionId}" to spec. Only running sessions can be converted.`)
                                                    return
                                                }
                                                // Open confirmation modal
                                                setConvertToDraftModal({
                                                    open: true,
                                                    sessionName: sessionId,
                                                    sessionDisplayName: getSessionDisplayName(session.info),
                                                    hasUncommitted: session.info.has_uncommitted_changes || false
                                                })
                                            }
                                        }}
                                        onRunDraft={(sessionId) => {
                                            try {
                                                emitUiEvent(UiEvent.StartAgentFromSpec, { name: sessionId })
                                            } catch (err) {
                                                logger.error('Failed to open start modal from spec:', err)
                                            }
                                        }}
                                        onRefineSpec={(sessionId) => {
                                            const target = sessions.find(s => s.info.session_id === sessionId)
                                            const displayName = target ? getSessionDisplayName(target.info) : undefined
                                            runRefineSpecFlow(sessionId, displayName)
                                        }}
                                        onDeleteSpec={(sessionId) => {
                                            const session = sessions.find(s => s.info.session_id === sessionId)
                                            const sessionDisplayName = session ? getSessionDisplayName(session.info) : sessionId

                                            emitUiEvent(UiEvent.SessionAction, {
                                                action: 'delete-spec',
                                                sessionId,
                                                sessionName: sessionId,
                                                sessionDisplayName,
                                                branch: session?.info.branch,
                                                hasUncommittedChanges: false,
                                            })
                                        }}
                                        onSelectBestVersion={handleSelectBestVersion}
                                        onReset={(sessionId) => {
                                            void (async () => {
                                                const currentSelection = selection.kind === 'session' && selection.payload === sessionId
                                                    ? selection
                                                    : { kind: 'session' as const, payload: sessionId }
                                                await resetSession(currentSelection, terminals)
                                            })()
                                        }}
                                        onSwitchModel={(sessionId) => {
                                            setSwitchModelSessionId(sessionId)
                                            const session = sessions.find(s => s.info.session_id === sessionId)
                                            const initialAgentType = normalizeAgentType(session?.info.original_agent_type)
                                            const initialSkipPermissions = Boolean(session?.info && (session.info as { original_skip_permissions?: boolean }).original_skip_permissions)
                                            setSwitchOrchestratorModal({ open: true, initialAgentType, initialSkipPermissions, targetSessionId: sessionId })
                                        }}
                                        resettingSelection={resettingSelection}
                                        isSessionRunning={isSessionRunning}
                                        onMerge={handleMergeSession}
                                        onQuickMerge={(sessionId) => { void handleMergeShortcut(sessionId) }}
                                        isMergeDisabled={isSessionMerging}
                                        getMergeStatus={getMergeStatus}
                                        isMarkReadyDisabled={isMarkReadyCoolingDown}
                                        isSessionBusy={isSessionMutating}
                                    />
                                )
                            })
                        })()
                    )
                )}
            </div>
            
            <ConvertToSpecConfirmation
                open={convertToSpecModal.open}
                sessionName={convertToSpecModal.sessionName}
                sessionDisplayName={convertToSpecModal.sessionDisplayName}
                hasUncommittedChanges={convertToSpecModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={(newSpecName) => {
                    if (convertToSpecModal.sessionName) {
                        optimisticallyConvertSessionToSpec(convertToSpecModal.sessionName)
                    }
                    void (async () => {
                        await reloadSessionsAndRefreshIdle()
                        if (newSpecName) {
                            await setSelection(
                                {
                                    kind: 'session',
                                    payload: newSpecName,
                                    sessionState: 'spec',
                                },
                                true,
                                true,
                            )
                        }
                    })()
                }}
            />
            <PromoteVersionConfirmation
                open={promoteVersionModal.open}
                versionGroup={promoteVersionModal.versionGroup}
                selectedSessionId={promoteVersionModal.selectedSessionId}
                onClose={() => setPromoteVersionModal({ open: false, versionGroup: null, selectedSessionId: '' })}
                onConfirm={() => {
                    const { versionGroup, selectedSessionId } = promoteVersionModal
                    setPromoteVersionModal({ open: false, versionGroup: null, selectedSessionId: '' })
                    if (versionGroup) {
                        void executeVersionPromotion(versionGroup, selectedSessionId)
                    }
                }}
            />
            <MergeSessionModal
                open={mergeDialogState.isOpen}
                sessionName={mergeDialogState.sessionName}
                status={mergeDialogState.status}
                preview={mergeDialogState.preview}
                error={mergeDialogState.error ?? undefined}
                onClose={closeMergeDialog}
                cachedCommitMessage={activeMergeCommitDraft}
                onCommitMessageChange={updateActiveMergeCommitDraft}
                onConfirm={(mode, commitMessage) => {
                    if (mergeDialogState.sessionName) {
                        void confirmMerge(mergeDialogState.sessionName, mode, commitMessage)
                    }
                }}
                autoCancelEnabled={autoCancelAfterMerge}
                onToggleAutoCancel={(next) => { void updateAutoCancelAfterMerge(next) }}
            />
            <SwitchOrchestratorModal
                open={switchOrchestratorModal.open}
                scope={switchOrchestratorModal.targetSessionId ? 'session' : 'orchestrator'}
                onClose={() => {
                    setSwitchOrchestratorModal({ open: false })
                    setSwitchModelSessionId(null)
                }}
                onSwitch={async ({ agentType, skipPermissions }) => {
                    // Determine which session/orchestrator to switch model for
                    const targetSelection = switchModelSessionId
                        ? { kind: 'session' as const, payload: switchModelSessionId }
                        : selection

                    await switchModel(agentType, skipPermissions, targetSelection, terminals, clearTerminalTracking, clearTerminalStartedTracking)

                    // Reload sessions to show updated agent type
                    await reloadSessionsAndRefreshIdle()

                    setSwitchOrchestratorModal({ open: false })
                    setSwitchModelSessionId(null)
                }}
                initialAgentType={switchOrchestratorModal.initialAgentType}
                initialSkipPermissions={switchOrchestratorModal.initialSkipPermissions}
                targetSessionId={switchOrchestratorModal.targetSessionId}
            />
        </div>
    )
}
