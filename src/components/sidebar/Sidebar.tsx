import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import clsx from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { GitOperationPayload } from '../../common/events'
import { useSelection } from '../../contexts/SelectionContext'
import { useSessions } from '../../contexts/SessionsContext'
import { captureSelectionSnapshot, SelectionMemoryEntry } from '../../utils/selectionMemory'
import { computeSelectionCandidate } from '../../utils/selectionPostMerge'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { ConvertToSpecConfirmation } from '../modals/ConvertToSpecConfirmation'
import { FilterMode, SortMode, FILTER_MODES } from '../../types/sessionFilters'
import { calculateFilterCounts } from '../../utils/sessionFilters'
import { groupSessionsByVersion, selectBestVersionAndCleanup, SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { SessionVersionGroup } from './SessionVersionGroup'
import { PromoteVersionConfirmation } from '../modals/PromoteVersionConfirmation'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'
import { MergeSessionModal } from '../modals/MergeSessionModal'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { VscRefresh, VscCode } from 'react-icons/vsc'
import { IconButton } from '../common/IconButton'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { logger } from '../../utils/logger'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { EnrichedSession, SessionInfo } from '../../types/session'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useRun } from '../../contexts/RunContext'
import { useModal } from '../../contexts/ModalContext'
import { useProject } from '../../contexts/ProjectContext'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { theme } from '../../common/theme'

// Normalize backend states to UI categories
function mapSessionUiState(info: SessionInfo): 'spec' | 'running' | 'reviewed' {
    if (info.session_state === 'spec' || info.status === 'spec') return 'spec'
    if (info.ready_to_merge) return 'reviewed'
    return 'running'
}

function isSpec(info: SessionInfo): boolean { return mapSessionUiState(info) === 'spec' }
function isReviewed(info: SessionInfo): boolean { return mapSessionUiState(info) === 'reviewed' }

// Removed legacy terminal-stuck idle handling; we rely on last-edited timestamps only

interface SidebarProps {
    isDiffViewerOpen?: boolean
    openTabs?: Array<{projectPath: string, projectName: string}>
    onSelectPrevProject?: () => void
    onSelectNextProject?: () => void
}

export function Sidebar({ isDiffViewerOpen, openTabs = [], onSelectPrevProject, onSelectNextProject }: SidebarProps) {
    const { selection, setSelection, terminals, clearTerminalTracking } = useSelection()
    const { projectPath } = useProject()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const { isSessionRunning } = useRun()
    const { isAnyModalOpen } = useModal()
    const github = useGithubIntegrationContext()
    const { 
        sessions,
        allSessions,
        loading,
        sortMode,
        filterMode,
        searchQuery,
        isSearchVisible,
        setSortMode,
        setFilterMode,
        setSearchQuery,
        setIsSearchVisible,
        reloadSessions,
        optimisticallyConvertSessionToSpec,
        mergeDialogState,
        openMergeDialog,
        closeMergeDialog,
        confirmMerge,
        isMergeInFlight,
        getMergeStatus,
        autoCancelAfterMerge,
        updateAutoCancelAfterMerge,
        beginSessionMutation,
        endSessionMutation,
        isSessionMutating,
    } = useSessions()
    const { isResetting, resettingSelection, resetSession, switchModel } = useSessionManagement()

    // Get dynamic shortcut for Orchestrator
    const orchestratorShortcut = useShortcutDisplay(KeyboardShortcutAction.SwitchToOrchestrator)

    // Removed: stuckTerminals; idle is computed from last edit timestamps
    const [sessionsWithNotifications, setSessionsWithNotifications] = useState<Set<string>>(new Set())
    const [orchestratorBranch, setOrchestratorBranch] = useState<string>("main")
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
    const fetchOrchestratorBranch = useCallback(async () => {
        try {
            const branch = await invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: null })
            setOrchestratorBranch(branch || "main")
        } catch (error) {
            logger.warn('Failed to get current branch, defaulting to main:', error)
            setOrchestratorBranch("main")
        }
    }, [])
    const [keyboardNavigatedFilter, setKeyboardNavigatedFilter] = useState<FilterMode | null>(null)
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState(false)
    const [switchModelSessionId, setSwitchModelSessionId] = useState<string | null>(null)
    const orchestratorResetting = resettingSelection?.kind === 'orchestrator'
    const orchestratorRunning = isSessionRunning('orchestrator')

    const isSessionMergeInFlight = useCallback(
        (sessionId: string) =>
            isMergeInFlight(sessionId) ||
            (mergeDialogState.status === 'running' && mergeDialogState.sessionName === sessionId),
        [isMergeInFlight, mergeDialogState]
    )

    const handleMergeSession = useCallback(
        (sessionId: string) => {
            if (isSessionMergeInFlight(sessionId)) return
            openMergeDialog(sessionId)
        },
        [isSessionMergeInFlight, openMergeDialog]
    )

    const [markReadyModal, setMarkReadyModal] = useState<{ open: boolean; sessionName: string; hasUncommitted: boolean }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
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
    const sidebarRef = useRef<HTMLDivElement>(null)
    const isProjectSwitching = useRef(false)

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

    const reloadSessionsAndRefreshIdle = useCallback(async () => {
        await reloadSessions()
    }, [reloadSessions]);
    
    // Maintain per-filter selection memory and choose the next best session when visibility changes
    useEffect(() => {
        if (isProjectSwitching.current) return

        const memory = ensureProjectMemory();
        const entry = memory[filterMode];

        const visibleSessions = sessions
        const visibleIds = new Set(visibleSessions.map(s => s.info.session_id))
        const currentSelectionId = selection.kind === 'session' ? (selection.payload ?? null) : null

        const { previousSessions } = captureSelectionSnapshot(entry, visibleSessions)

        const removalCandidate = lastRemovedSessionRef.current
        const mergedCandidate = lastMergedReviewedSessionRef.current

        const mergedSessionInfo = mergedCandidate
            ? allSessions.find(s => s.info.session_id === mergedCandidate)
            : undefined
        const mergedStillReviewed = mergedSessionInfo?.info.ready_to_merge ?? false

        const shouldAdvanceFromMerged = Boolean(
            mergedCandidate &&
            currentSelectionId === mergedCandidate &&
            !mergedStillReviewed
        )

        if (mergedCandidate && (!currentSelectionId || currentSelectionId !== mergedCandidate)) {
            lastMergedReviewedSessionRef.current = null
        }

        // Check if the removed session was a reviewed session
        const wasReviewedSession = removalCandidate ?
            allSessions.find(s => s.info.session_id === removalCandidate)?.info.ready_to_merge : false
        const shouldPreserveForReviewedRemoval = Boolean(wasReviewedSession && removalCandidate && filterMode !== FilterMode.Reviewed)

        if (selection.kind === 'orchestrator') {
            entry.lastSelection = null
            if (!removalCandidate && !shouldAdvanceFromMerged) {
                return
            }
        }

        if (visibleSessions.length === 0) {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
            if (lastRemovedSessionRef.current) {
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
            removalCandidate,
            mergedCandidate,
            shouldAdvanceFromMerged,
            shouldPreserveForReviewedRemoval,
            allSessions
        })

        if (candidateId) {
            entry.lastSelection = candidateId
            if (candidateId !== currentSelectionId) {
                const targetSession = visibleSessions.find(s => s.info.session_id === candidateId)
                    ?? allSessions.find(s => s.info.session_id === candidateId)
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

        if (removalCandidate) {
            lastRemovedSessionRef.current = null
        }
        if (shouldAdvanceFromMerged) {
            lastMergedReviewedSessionRef.current = null
        }
    }, [sessions, selection, filterMode, ensureProjectMemory, allSessions, setSelection])

    // Fetch current branch for orchestrator
    useEffect(() => { void fetchOrchestratorBranch() }, [fetchOrchestratorBranch])

    useEffect(() => {
        if (selection.kind !== 'orchestrator') return
        void fetchOrchestratorBranch()
    }, [selection, fetchOrchestratorBranch])

    useEffect(() => {
        let unlisten: UnlistenFn | null = null

        const attach = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.ProjectReady, () => { void fetchOrchestratorBranch() })
            } catch (error) {
                logger.warn('Failed to listen for project ready events:', error)
            }
        }

        void attach()

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [fetchOrchestratorBranch])

    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator' }, false, true) // User clicked - intentional
    }
    
    // Helper to flatten grouped sessions into a linear array
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

    const handleSelectSession = async (index: number) => {
        // When sessions are grouped, we need to find the correct session by flattening the groups
        const flattenedSessions = flattenGroupedSessions(sessions)
        
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
            const flattenedSessions = flattenGroupedSessions(sessions)
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
            const flattenedSessions = flattenGroupedSessions(sessions)
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, flattenedSessions.length - 1)
            if (nextIndex != currentIndex) {
                await handleSelectSession(nextIndex)
            }
        }
    }

    const handleMarkReady = useCallback(async (sessionId: string, hasUncommitted: boolean) => {
        try {
            // Check global auto-commit setting first
            const globalAutoCommit = await invoke<boolean>(TauriCommands.GetAutoCommitOnReview)
            
            if (globalAutoCommit) {
                // Auto-commit is enabled, execute directly without modal
                try {
                    const success = await invoke<boolean>(TauriCommands.SchaltwerkCoreMarkSessionReady, {
                        name: sessionId,
                        autoCommit: true // Explicitly commit when global auto-commit is enabled
                    })
                    
                    if (success) {
                        // Reload sessions to reflect the change
                        await reloadSessionsAndRefreshIdle()
                    } else {
                        alert('Failed to mark session as reviewed automatically.')
                    }
                } catch (error) {
                    logger.error('Failed to auto-mark session as reviewed:', error)
                    alert(`Failed to mark session as reviewed: ${error}`)
                }
            } else {
                // Auto-commit is disabled, show modal for confirmation
                setMarkReadyModal({
                    open: true,
                    sessionName: sessionId,
                    hasUncommitted
                })
            }
        } catch (error) {
            logger.error('Failed to load auto-commit setting:', error)
            // If settings check fails, fall back to showing the modal
            setMarkReadyModal({
                open: true,
                sessionName: sessionId,
                hasUncommitted
            })
        }
    }, [reloadSessionsAndRefreshIdle, setMarkReadyModal])

    const triggerMarkReady = useCallback(async (sessionId: string, hasUncommitted: boolean) => {
        if (markReadyCooldownRef.current) {
            logger.debug(`[Sidebar] Skipping mark-ready for ${sessionId} (cooldown active)`)
            return
        }

        logger.debug(`[Sidebar] Triggering mark-ready for ${sessionId} (hasUncommitted=${hasUncommitted})`)
        engageMarkReadyCooldown('mark-ready-trigger')
        try {
            await handleMarkReady(sessionId, hasUncommitted)
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

        if (sessionInfo.ready_to_merge) {
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

        await triggerMarkReady(sessionInfo.session_id, sessionInfo.has_uncommitted_changes || false)
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
            executeVersionPromotion(targetGroup, selectedSessionId)
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

    // Filter navigation functions
    const handleNavigateToPrevFilter = () => {
        const currentIndex = FILTER_MODES.indexOf(filterMode)
        const prevIndex = currentIndex === 0 ? FILTER_MODES.length - 1 : currentIndex - 1
        const nextFilter = FILTER_MODES[prevIndex]
        
        // Trigger keyboard navigation animation
        setKeyboardNavigatedFilter(nextFilter)
        setTimeout(() => setKeyboardNavigatedFilter(null), 400) // Clear after animation
        
        setFilterMode(nextFilter)
        
        // Smart session selection after filter change
        setTimeout(() => {
            // If current selection is not visible in the new filter, select the first visible session
            if (selection.kind === 'session') {
                const sessionsAfterFilter = sessions // This will be the new filtered list after setFilterMode
                const currentSessionVisible = sessionsAfterFilter.some(s => s.info.session_id === selection.payload)
                
                if (!currentSessionVisible && sessionsAfterFilter.length > 0) {
                    // Select the first session in the new filter
                    const firstSession = sessionsAfterFilter[0]
                    setSelection({
                        kind: 'session',
                        payload: firstSession.info.session_id,
                        worktreePath: firstSession.info.worktree_path,
                        sessionState: mapSessionUiState(firstSession.info)
                    }, false, true) // User action - intentional
                }
            }
        }, 0) // Allow filter change to process first
    }

    const handleNavigateToNextFilter = () => {
        const currentIndex = FILTER_MODES.indexOf(filterMode)
        const nextIndex = (currentIndex + 1) % FILTER_MODES.length
        const nextFilter = FILTER_MODES[nextIndex]
        
        // Trigger keyboard navigation animation
        setKeyboardNavigatedFilter(nextFilter)
        setTimeout(() => setKeyboardNavigatedFilter(null), 400) // Clear after animation
        
        setFilterMode(nextFilter)
        
        // Smart session selection after filter change
        setTimeout(() => {
            // If current selection is not visible in the new filter, select the first visible session
            if (selection.kind === 'session') {
                const sessionsAfterFilter = sessions // This will be the new filtered list after setFilterMode
                const currentSessionVisible = sessionsAfterFilter.some(s => s.info.session_id === selection.payload)
                
                if (!currentSessionVisible && sessionsAfterFilter.length > 0) {
                    // Select the first session in the new filter
                    const firstSession = sessionsAfterFilter[0]
                    setSelection({
                        kind: 'session',
                        payload: firstSession.info.session_id,
                        worktreePath: firstSession.info.worktree_path,
                        sessionState: mapSessionUiState(firstSession.info)
                    }, false, true) // User action - intentional
                }
            }
        }, 0) // Allow filter change to process first
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
            setSwitchOrchestratorModal(true)
            return
        }

        if (selection.kind !== 'session' || !selection.payload) return

        const state = getSelectedSessionState()
        if (state !== 'running') return

        setSwitchModelSessionId(selection.payload)
        setSwitchOrchestratorModal(true)
    }, [isAnyModalOpen, selection, getSelectedSessionState, setSwitchModelSessionId, setSwitchOrchestratorModal])

    const handleOpenMergeShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !session.info.ready_to_merge) return
        if (isSessionMergeInFlight(selection.payload)) return
        openMergeDialog(selection.payload)
    }, [isAnyModalOpen, selection, sessions, openMergeDialog, isSessionMergeInFlight])

    const handleCreatePullRequestShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !session.info.ready_to_merge) return
        if (!github.canCreatePr) return
        emitUiEvent(UiEvent.CreatePullRequest, { sessionId: selection.payload })
    }, [isAnyModalOpen, selection, sessions, github.canCreatePr])

    useKeyboardShortcuts({
        onSelectOrchestrator: handleSelectOrchestrator,
        onSelectSession: handleSelectSession,
        onCancelSelectedSession: handleCancelSelectedSession,
        onMarkSelectedSessionReady: handleMarkSelectedSessionReady,
        onSpecSession: handleSpecSelectedSession,
        onPromoteSelectedVersion: handlePromoteSelectedVersion,
        sessionCount: sessions.length,
        onSelectPrevSession: selectPrev,
        onSelectNextSession: selectNext,
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
            // Open diff viewer for both sessions and orchestrator
            if (selection.kind !== 'session' && selection.kind !== 'orchestrator') return
            emitUiEvent(UiEvent.OpenDiffView)
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
        onOpenMergeModal: handleOpenMergeShortcut,
        onCreatePullRequest: handleCreatePullRequestShortcut,
        isDiffViewerOpen
    })

    // Sessions are now managed by SessionsContext with integrated sorting/filtering
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        const cleanup = listenUiEvent(UiEvent.GlobalMarkReadyShortcut, () => handleMarkSelectedSessionReady())
        return cleanup
    }, [selection, sessions, handleMarkSelectedSessionReady])

    // Selection is now restored by SelectionContext itself

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
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                    })
                }
            })
        })
    }, [selection])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let unlisteners: UnlistenFn[] = []

        const attach = async () => {
            // Activity and git stats updates are handled by SessionsContext

            // Session added
            // We don't listen to session-added here anymore - selection should only change
            // when explicitly requested by the user through App.tsx, not through event listeners.
            // This prevents unwanted selection changes when creating sessions that don't match
            // the current filter.

            // Session removed
            const u4 = await listenEvent(SchaltEvent.SessionRemoved, (event) => {
                lastRemovedSessionRef.current = event.session_name
            })
            unlisteners.push(u4)

            const uMergeCompleted = await listenEvent(SchaltEvent.GitOperationCompleted, (event: GitOperationPayload) => {
                if (event?.operation === 'merge') {
                    lastMergedReviewedSessionRef.current = event.session_name
                }
            })
            unlisteners.push(uMergeCompleted)
            
            // Listen for follow-up message notifications
            const u5 = await listenEvent(SchaltEvent.FollowUpMessage, (event) => {
                const { session_name, message, message_type } = event
                
                // Add visual notification badge for the session
                setSessionsWithNotifications(prev => new Set([...prev, session_name]))
                
                // Find the session to get its worktree path
                const session = latestSessionsRef.current.find(s => s.info.session_id === session_name)
                if (session) {
                    // Focus the session when review content is pasted, including worktree path
                    setSelection({
                        kind: 'session',
                        payload: session_name,
                        worktreePath: session.info.worktree_path,
                        sessionState: mapSessionUiState(session.info)
                    }, false, true) // Backend requested - intentional
                    // Set Claude focus for the session
                    setFocusForSession(session_name, 'claude')
                    setCurrentFocus('claude')
                }
                
                // Show a toast notification
                logger.info(`📬 Follow-up message for ${session_name}: ${message}`)
                
                // For now, just log the message - in the future we could show toast notifications
                if (message_type === 'system') {
                    logger.info(`📢 System message for session ${session_name}: ${message}`)
                } else {
                    logger.info(`💬 User message for session ${session_name}: ${message}`)
                }
            })
            unlisteners.push(u5)
        }
        attach()
        
        return () => {
            unlisteners.forEach(unlisten => {
                try {
                    if (typeof unlisten === 'function') unlisten()
                } catch (e) {
                    logger.warn('Failed to unlisten sidebar event', e)
                }
            })
        }
    // Attach once on mount; use refs above for latest values inside handlers
    }, [setCurrentFocus, setFocusForSession, setSelection])

    useEffect(() => () => cancelMarkReadyCooldown(), [cancelMarkReadyCooldown])

    // Calculate counts based on all sessions (unaffected by search)
    const { allCount, specsCount, runningCount, reviewedCount } = calculateFilterCounts(allSessions)

    return (
        <div ref={sidebarRef} className="h-full flex flex-col min-h-0">
            <div className="h-8 px-3 border-b border-slate-800 text-xs flex items-center text-slate-300">Repository (Orchestrator)</div>

            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx(
                        'w-full text-left px-3 py-2 rounded-md mb-1 group border transition-all duration-300',
                        selection.kind === 'orchestrator'
                            ? 'bg-slate-800/60 session-ring session-ring-blue border-transparent'
                            : 'hover:bg-slate-800/30 border-slate-800',
                        orchestratorRunning && selection.kind !== 'orchestrator' &&
                            'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20'
                    )}
                    aria-label="Select orchestrator (⌘1)"
                >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100 flex items-center gap-2">
                            orchestrator
                            {orchestratorRunning && (
                                <span className={clsx(
                                    'text-[10px] px-1.5 py-0.5 rounded border'
                                )}
                                style={{
                                    backgroundColor: theme.colors.accent.magenta.bg,
                                    color: theme.colors.accent.magenta.DEFAULT,
                                    borderColor: theme.colors.accent.magenta.border
                                }}
                                >
                                    Running
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-0.5">
                                <IconButton
                                    icon={<VscCode />}
                                    onClick={() => {
                                        setSwitchModelSessionId(null)
                                        setSwitchOrchestratorModal(true)
                                    }}
                                    ariaLabel="Switch orchestrator model"
                                    tooltip="Switch model (⌘P)"
                                />
                                <IconButton
                                    icon={<VscRefresh />}
                                    onClick={async () => {
                                        if (selection.kind === 'orchestrator') {
                                            await resetSession(selection, terminals)
                                        }
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
                    </div>
                    <div className="text-xs text-slate-500">Original repository from which agents are created</div>
                </button>
            </div>

            <div className="h-8 px-3 border-t border-b border-slate-800 text-xs text-slate-300 flex items-center">
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
                                            const sanitize = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
                                            if (selection.kind === 'session' && selection.payload) {
                                                emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sanitize(selection.payload) })
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
                        <button
                            className="px-1.5 py-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white flex items-center gap-0.5 flex-shrink-0"
                            onClick={() => {
                                // Cycle through: name -> created -> last-edited -> name
                                const nextMode = sortMode === SortMode.Name ? SortMode.Created : 
                                               sortMode === SortMode.Created ? SortMode.LastEdited : SortMode.Name
                                setSortMode(nextMode)
                            }}
                            title={`Sort: ${sortMode === SortMode.Name ? 'Name (A-Z)' : sortMode === SortMode.Created ? 'Creation Time' : 'Last Edited'}`}
                        >
                            {/* Sort icon - compact */}
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                            {/* Compact text indicator */}
                            <span className="text-[9px] font-medium leading-none w-6 text-left">
                                {sortMode === SortMode.Name ? 'A-Z' : sortMode === SortMode.Created ? 'New' : 'Edit'}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Search Line - appears below filters when active */}
            {isSearchVisible && (
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
                                    const sanitize = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sanitize(selection.payload) })
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
                                    const sanitize = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sanitize(selection.payload) })
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
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2" data-testid="session-scroll-container">
                {sessions.length === 0 && !loading ? (
                    <div className="text-center text-slate-500 py-4">No active agents</div>
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
                                    onMarkReady={(sessionId, hasUncommitted) => {
                                        if (markReadyCooldownRef.current) {
                                            return
                                        }
                                        void triggerMarkReady(sessionId, hasUncommitted)
                                    }}
                                    onUnmarkReady={async (sessionId) => {
                                        if (markReadyCooldownRef.current) {
                                            return
                                        }

                                        engageMarkReadyCooldown('unmark-ready-click')
                                        try {
                                            await invoke(TauriCommands.SchaltwerkCoreUnmarkSessionReady, { name: sessionId })
                                            // Reload both regular and spec sessions to avoid dropping specs
                                            await Promise.all([
                                                invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions),
                                                invoke<SessionInfo[]>(TauriCommands.SchaltwerkCoreListSessionsByState, { state: 'spec' })
                                            ])
                                            await reloadSessionsAndRefreshIdle()
                                        } catch (err) {
                                            logger.error('Failed to unmark reviewed session:', err)
                                        } finally {
                                            scheduleMarkReadyCooldownRelease('unmark-ready-click-complete')
                                        }
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
                                    onRunDraft={async (sessionId) => {
                                        try {
                                            emitUiEvent(UiEvent.StartAgentFromSpec, { name: sessionId })
                                        } catch (err) {
                                            logger.error('Failed to open start modal from spec:', err)
                                        }
                                    }}
                                    onDeleteSpec={async (sessionId) => {
                                        beginSessionMutation(sessionId, 'remove')
                                        try {
                                            await invoke(TauriCommands.SchaltwerkCoreCancelSession, { name: sessionId })
                                            // Reload both regular and spec sessions to ensure remaining specs persist
                                            await Promise.all([
                                                invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions),
                                                invoke<SessionInfo[]>(TauriCommands.SchaltwerkCoreListSessionsByState, { state: 'spec' })
                                            ])
                                            await reloadSessionsAndRefreshIdle()
                                        } catch (err) {
                                            logger.error('Failed to delete spec:', err)
                                        } finally {
                                            endSessionMutation(sessionId, 'remove')
                                        }
                                    }}
                                    onSelectBestVersion={handleSelectBestVersion}
                                    onReset={async (sessionId) => {
                                        const currentSelection = selection.kind === 'session' && selection.payload === sessionId
                                            ? selection
                                            : { kind: 'session' as const, payload: sessionId }
                                        await resetSession(currentSelection, terminals)
                                    }}
                                    onSwitchModel={(sessionId) => {
                                        setSwitchModelSessionId(sessionId)
                                        setSwitchOrchestratorModal(true)
                                    }}
                                    resettingSelection={resettingSelection}
                                    isSessionRunning={isSessionRunning}
                                    onMerge={handleMergeSession}
                                    isMergeDisabled={isSessionMergeInFlight}
                                    getMergeStatus={getMergeStatus}
                                    isMarkReadyDisabled={isMarkReadyCoolingDown}
                                    isSessionBusy={isSessionMutating}
                                />
                            )
                        })
                    })()
                )}
            </div>
            
            
            <MarkReadyConfirmation
                open={markReadyModal.open}
                sessionName={markReadyModal.sessionName}
                hasUncommittedChanges={markReadyModal.hasUncommitted}
                onClose={() => setMarkReadyModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    // Reload both regular and spec sessions
                    await reloadSessionsAndRefreshIdle()
                }}
            />
            <ConvertToSpecConfirmation
                open={convertToSpecModal.open}
                sessionName={convertToSpecModal.sessionName}
                sessionDisplayName={convertToSpecModal.sessionDisplayName}
                hasUncommittedChanges={convertToSpecModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    if (convertToSpecModal.sessionName) {
                        optimisticallyConvertSessionToSpec(convertToSpecModal.sessionName)
                    }
                    await reloadSessionsAndRefreshIdle()
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
                        executeVersionPromotion(versionGroup, selectedSessionId)
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
                onConfirm={(mode, commitMessage) => {
                    if (mergeDialogState.sessionName) {
                        void confirmMerge(mergeDialogState.sessionName, mode, commitMessage)
                    }
                }}
                autoCancelEnabled={autoCancelAfterMerge}
                onToggleAutoCancel={(next) => { void updateAutoCancelAfterMerge(next) }}
            />
            <SwitchOrchestratorModal
                open={switchOrchestratorModal}
                onClose={() => {
                    setSwitchOrchestratorModal(false)
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
                    
                    setSwitchOrchestratorModal(false)
                    setSwitchModelSessionId(null)
                }}
            />
        </div>
    )
}
