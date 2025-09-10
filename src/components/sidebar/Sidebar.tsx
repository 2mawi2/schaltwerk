import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { useSelection } from '../../contexts/SelectionContext'
import { useSessions } from '../../contexts/SessionsContext'
import { computeNextSelectedSessionId, findPreviousSessionIndex } from '../../utils/selectionNext'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { ConvertToSpecConfirmation } from '../modals/ConvertToSpecConfirmation'
import { FilterMode, SortMode, FILTER_MODES } from '../../types/sessionFilters'
import { calculateFilterCounts, isSpec as isSpecSession } from '../../utils/sessionFilters'
import { groupSessionsByVersion, selectBestVersionAndCleanup, SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { SessionVersionGroup } from './SessionVersionGroup'
import { PromoteVersionConfirmation } from '../modals/PromoteVersionConfirmation'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'
import { VscRefresh, VscCode, VscTarget, VscClose } from 'react-icons/vsc'
import { IconButton } from '../common/IconButton'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { SpecModeState } from '../../hooks/useSpecMode'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { EnrichedSession, SessionInfo } from '../../types/session'
import { useRun } from '../../contexts/RunContext'
import { useModal } from '../../contexts/ModalContext'

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
    specModeState?: SpecModeState
    onSpecSelect?: (specName: string) => void
}

export function Sidebar({ isDiffViewerOpen, openTabs = [], onSelectPrevProject, onSelectNextProject, specModeState, onSpecSelect }: SidebarProps) {
    const { selection, setSelection, terminals, clearTerminalTracking } = useSelection()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const { isSessionRunning } = useRun()
    const { isAnyModalOpen } = useModal()
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
        reloadSessions 
    } = useSessions()
    const { isResetting, resetSession, switchModel } = useSessionManagement()
    // Removed: stuckTerminals; idle is computed from last edit timestamps
    const [sessionsWithNotifications, setSessionsWithNotifications] = useState<Set<string>>(new Set())
    const [idleByTime, setIdleByTime] = useState<Set<string>>(new Set())
    const [orchestratorBranch, setOrchestratorBranch] = useState<string>("main")
    const [keyboardNavigatedFilter, setKeyboardNavigatedFilter] = useState<FilterMode | null>(null)
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState(false)
    const [switchModelSessionId, setSwitchModelSessionId] = useState<string | null>(null)
    
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
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
    
    // Auto-select appropriate session when current selection disappears from view
    useEffect(() => {
        // Skip auto-selection during project switches to avoid conflicts with restoration
        if (isProjectSwitching.current) return
        
        if (selection.kind !== 'session') return
        
        const currentSessionVisible = sessions.some(s => s.info.session_id === selection.payload)
        
        if (!currentSessionVisible && sessions.length > 0 && selection.payload) {
            const prevSessions = latestSortedSessionsRef.current
            const prevIndex = findPreviousSessionIndex(prevSessions, selection.payload)
            
            let targetSession
            if (prevIndex >= 0) {
                // Try to select the session now at the same index position
                const targetIndex = Math.min(prevIndex, sessions.length - 1)
                targetSession = sessions[targetIndex]
            } else {
                // Session wasn't found in previous list, select first available session
                targetSession = sessions[0]
            }
            
            if (targetSession) {
                setSelection({
                    kind: 'session',
                    payload: targetSession.info.session_id,
                    worktreePath: targetSession.info.worktree_path,
                    sessionState: mapSessionUiState(targetSession.info)
                }, false, false) // Auto-selection - not intentional
            }
        } else if (!currentSessionVisible && sessions.length === 0) {
            // No sessions visible, select orchestrator
            setSelection({ kind: 'orchestrator' }, false, false) // Auto-selection - not intentional
        }
    }, [sessions, selection, setSelection])

    // Fetch current branch for orchestrator
    useEffect(() => {
        invoke<string>("get_current_branch_name", { sessionName: null })
            .then(branch => setOrchestratorBranch(branch))
            .catch(error => {
                logger.warn('Failed to get current branch, defaulting to main:', error)
                setOrchestratorBranch("main")
            })
    }, [])

    // Compute time-based idle sessions from last activity
    useEffect(() => {
        const recomputeIdle = () => {
            const now = Date.now()
            const next = new Set<string>()
            for (const s of allSessions) {
                const ts: number | undefined = (s.info as any).last_modified_ts
                const spec = isSpec(s.info)
                const reviewed = isReviewed(s.info)
                if (typeof ts === 'number' && !spec && !reviewed && now - ts >= IDLE_THRESHOLD_MS) {
                    next.add(s.info.session_id)
                }
            }
            setIdleByTime(next)
        }

        // Run immediately and then every 30s
        recomputeIdle()
        const t = setInterval(recomputeIdle, 30_000)
        return () => clearInterval(t)
    }, [allSessions, IDLE_THRESHOLD_MS])

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
                // Check if it's a spec
                if (isSpec(selectedSession.info)) {
                    // For specs, always show confirmation dialog (ignore immediate flag)
                    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                        detail: {
                            action: 'delete-spec',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: false // Specs don't have uncommitted changes
                        }
                    }))
                } else {
                    // For regular sessions, handle as before
                    if (immediate) {
                        // immediate cancel without modal
                        window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                            detail: {
                                action: 'cancel-immediate',
                                sessionId: selectedSession.info.session_id,
                                sessionName: selectedSession.info.session_id,
                                sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                                branch: selectedSession.info.branch,
                                hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                            }
                        }))
                    } else {
                        window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                            detail: {
                                action: 'cancel',
                                sessionId: selectedSession.info.session_id,
                                sessionName: selectedSession.info.session_id,
                                sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                                branch: selectedSession.info.branch,
                                hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false
                            }
                        }))
                    }
                }
            }
        }
    }

    const selectPrev = async () => {
        if (sessions.length === 0) return
        
        // In spec mode, navigate through specs when orchestrator is selected
        if (isInSpecMode && selection.kind === 'orchestrator' && specModeState?.currentSpec) {
            const specs = sessions.filter(s => isSpecSession(s.info))
            const currentSpecIndex = specs.findIndex(s => s.info.session_id === specModeState.currentSpec)
            if (currentSpecIndex > 0) {
                const prevSpec = specs[currentSpecIndex - 1]
                onSpecSelect?.(prevSpec.info.session_id)
                return
            }
            // Already at first spec, do nothing
            return
        }
        
        if (selection.kind === 'session') {
            // Use the helper to get flattened sessions
            const flattenedSessions = flattenGroupedSessions(sessions)
            
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            // If at the first session, go to orchestrator
            if (currentIndex <= 0) {
                await handleSelectOrchestrator()
                return
            }
            await handleSelectSession(currentIndex - 1)
            return
        }
        // If orchestrator is selected (and not in spec mode), do nothing on ArrowUp
    }

    const selectNext = async () => {
        if (sessions.length === 0) return
        
        if (selection.kind === 'orchestrator') {
            // In spec mode, navigate through specs
            if (isInSpecMode && specModeState?.currentSpec) {
                const specs = sessions.filter(s => isSpecSession(s.info))
                const currentSpecIndex = specs.findIndex(s => s.info.session_id === specModeState.currentSpec)
                if (currentSpecIndex < specs.length - 1) {
                    const nextSpec = specs[currentSpecIndex + 1]
                    onSpecSelect?.(nextSpec.info.session_id)
                    return
                }
                // Already at last spec, do nothing
                return
            }
            // From orchestrator (not in spec mode), go to the first session
            await handleSelectSession(0)
            return
        }
        
        if (selection.kind === 'session') {
            // Use the helper to get flattened sessions
            const flattenedSessions = flattenGroupedSessions(sessions)
            
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, flattenedSessions.length - 1)
            if (nextIndex !== currentIndex) {
                await handleSelectSession(nextIndex)
            }
            return
        }
    }

    const handleMarkReady = async (sessionId: string, hasUncommitted: boolean) => {
        try {
            // Check global auto-commit setting first
            const globalAutoCommit = await invoke<boolean>('get_auto_commit_on_review')
            
            if (globalAutoCommit) {
                // Auto-commit is enabled, execute directly without modal
                try {
                    const success = await invoke<boolean>('schaltwerk_core_mark_session_ready', {
                        name: sessionId,
                        autoCommit: true // Explicitly commit when global auto-commit is enabled
                    })
                    
                    if (success) {
                        // Reload sessions to reflect the change
                        await reloadSessions()
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
    }

    const handleMarkSelectedSessionReady = useCallback(() => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !selectedSession.info.ready_to_merge) {
                // Prevent marking specs as reviewed
                if (isSpec(selectedSession.info)) {
                    logger.warn(`Cannot mark spec "${selectedSession.info.session_id}" as reviewed. Specs must be started as agents first.`)
                    return
                }

                handleMarkReady(selectedSession.info.session_id, selectedSession.info.has_uncommitted_changes || false)
            }
        }
    }, [selection, sessions, handleMarkReady])

    const handleSpecSelectedSession = () => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !isSpec(selectedSession.info) && !isReviewed(selectedSession.info)) {
                // Allow converting running sessions to specs only, not reviewed or spec sessions
                setConvertToDraftModal({
                    open: true,
                    sessionName: selectedSession.info.session_id,
                    sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
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
            await selectBestVersionAndCleanup(targetGroup, selectedSessionId, invoke, reloadSessions)
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
            setCurrentFocus('claude')
            // This will trigger TerminalGrid's currentFocus effect immediately
        },
        onOpenDiffViewer: () => {
            // Open diff viewer for both sessions and orchestrator
            if (selection.kind !== 'session' && selection.kind !== 'orchestrator') return
            window.dispatchEvent(new CustomEvent('schaltwerk:open-diff-view'))
        },
        onFocusTerminal: () => {
            // Don't dispatch focus events if any modal is open
            if (isAnyModalOpen()) {
                return
            }
            
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
            window.dispatchEvent(new CustomEvent('schaltwerk:focus-terminal'))
        },
        onSelectPrevProject: handleSelectPrevProject,
        onSelectNextProject: handleSelectNextProject,
        onNavigateToPrevFilter: handleNavigateToPrevFilter,
        onNavigateToNextFilter: handleNavigateToNextFilter,
        isDiffViewerOpen
    })

    // Sessions are now managed by SessionsContext with integrated sorting/filtering
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        const handler = () => handleMarkSelectedSessionReady()
        window.addEventListener('global-mark-ready-shortcut', handler as EventListener)
        return () => window.removeEventListener('global-mark-ready-shortcut', handler as any)
    }, [selection, sessions, handleMarkSelectedSessionReady])

    // Selection is now restored by SelectionContext itself

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSelectionRef = useRef(selection)
    const latestSortedSessionsRef = useRef(sessions)
    const latestFilterModeRef = useRef(filterMode)
    const latestSessionsRef = useRef(allSessions)

    useEffect(() => { latestSelectionRef.current = selection }, [selection])
    useEffect(() => { latestSortedSessionsRef.current = sessions }, [sessions])
    useEffect(() => { latestFilterModeRef.current = filterMode }, [filterMode])
    useEffect(() => { latestSessionsRef.current = allSessions }, [allSessions])

    // Scroll selected session into view when selection changes
    useEffect(() => {
        if (selection.kind !== 'session') return

        // Use requestAnimationFrame to ensure DOM updates are complete
        requestAnimationFrame(() => {
            // Add a small delay to ensure the selection state has been applied to the DOM
            setTimeout(() => {
                const selectedElement = sidebarRef.current?.querySelector(`[data-session-selected="true"]`)
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                    })
                }
            }, 50)
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
            const u4 = await listenEvent(SchaltEvent.SessionRemoved, async (event) => {
                const { session_name } = event
                const currentSelection = latestSelectionRef.current
                const currentSorted = latestSortedSessionsRef.current
                const currentSelectedId = currentSelection.kind === 'session' ? (currentSelection.payload || null) : null
                const nextSelectionId = computeNextSelectedSessionId(currentSorted, session_name, currentSelectedId)

                if (currentSelectedId === session_name) {
                    if (nextSelectionId) {
                        const nextSession = sessions.find(s => s.info.session_id === nextSelectionId)
                        await setSelection({ 
                            kind: 'session', 
                            payload: nextSelectionId,
                            worktreePath: nextSession?.info.worktree_path,
                            sessionState: nextSession ? mapSessionUiState(nextSession.info) : undefined
                        }, false, false) // Fallback - not intentional
                    } else {
                        // If the removed item is already gone from the list due to event timing,
                        // select the first visible item under the current filter, if any
                        const firstVisible = latestSortedSessionsRef.current[0]
                        if (firstVisible) {
                            await setSelection({
                                kind: 'session',
                                payload: firstVisible.info.session_id,
                                worktreePath: firstVisible.info.worktree_path,
                                sessionState: mapSessionUiState(firstVisible.info)
                            }, false, false)
                        } else {
                            await setSelection({ kind: 'orchestrator' }, false, false) // No items left
                        }
                    }
                }
            })
            unlisteners.push(u4)
            
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
    }, [sessions, setCurrentFocus, setFocusForSession, setSelection])

    // Calculate counts based on all sessions (unaffected by search)
    const { allCount, specsCount, runningCount, reviewedCount } = calculateFilterCounts(allSessions)

    // Check if we're in spec mode
    const isInSpecMode = selection.kind === 'orchestrator' && specModeState?.isActive
    
    // Handle clicking a spec in spec mode
    const handleSpecClick = (sessionId: string) => {
        if (isInSpecMode && onSpecSelect) {
            onSpecSelect(sessionId)
        } else {
            // Normal session selection
            const session = sessions.find(s => s.info.session_id === sessionId)
            if (session) {
                handleSelectSession(sessions.indexOf(session))
            }
        }
    }

    return (
        <div ref={sidebarRef} className="h-full flex flex-col">
            {/* Spec Mode Header */}
            {isInSpecMode ? (
                <div className="h-10 px-3 border-b flex items-center justify-between" style={{ 
                    backgroundColor: theme.colors.background.elevated,
                    borderColor: theme.colors.border.default
                }}>
                    <div className="flex items-center gap-2">
                        <VscTarget className="text-amber-500" />
                        <span className="text-xs font-medium" style={{ color: theme.colors.accent.amber.DEFAULT }}>
                            Spec Mode Active
                        </span>
                    </div>
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:exit-spec-mode'))}
                        className="text-xs px-1.5 py-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white"
                        title="Exit Spec Mode (Esc)"
                    >
                        <VscClose className="w-3 h-3" />
                    </button>
                </div>
            ) : (
                <div className="h-8 px-3 border-b border-slate-800 text-xs flex items-center text-slate-300">Repository (Orchestrator)</div>
            )}
            {/* Only show orchestrator button when not in spec mode */}
            {!isInSpecMode && (
                <div className="px-2 pt-2">
                    <button
                        onClick={handleSelectOrchestrator}
                        className={clsx('w-full text-left px-3 py-2 rounded-md mb-1 group', selection.kind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
                        title="Select orchestrator (⌘1)"
                    >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">orchestrator</div>
                    <div className="flex items-center gap-2">
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
                            <IconButton
                                icon={<VscCode />}
                                onClick={() => {
                                    setSwitchModelSessionId(null)
                                    setSwitchOrchestratorModal(true)
                                }}
                                ariaLabel="Switch orchestrator model"
                                tooltip="Switch model"
                            />
                            <IconButton
                                icon={<VscRefresh />}
                                onClick={async () => {
                                    if (selection.kind === 'orchestrator') {
                                        await resetSession(selection, terminals);
                                    }
                                }}
                                ariaLabel="Reset orchestrator"
                                tooltip="Reset orchestrator"
                                disabled={isResetting}
                            />
                        </div>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">⌘1</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">{orchestratorBranch}</span>
                    </div>
                    </div>
                    <div className="text-xs text-slate-500">Original repository from which agents are created</div>
                </button>
            </div>
            )}

            <div className="h-8 px-3 border-t border-b border-slate-800 text-xs text-slate-300 flex items-center">
                <div className="flex items-center gap-2 w-full">
                    <span className="text-xs flex-shrink-0">{isInSpecMode ? 'Specs' : 'Agents'}</span>
                    <div className="flex items-center gap-1 ml-auto flex-nowrap overflow-x-auto">
                        {/* Search Icon */}
                        <button
                            onClick={() => setIsSearchVisible(true)}
                            className={clsx('px-1 py-0.5 rounded hover:bg-slate-700/50 flex items-center flex-shrink-0',
                                isSearchVisible ? 'bg-slate-700/50 text-white' : 'text-slate-400 hover:text-white')}
                            title="Search sessions"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                        </button>
                        {/* In spec mode, show only specs filter */}
                        {isInSpecMode ? (
                            <button
                                className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 bg-amber-600/20 text-amber-400 cursor-default"
                                title="Showing specs only"
                            >
                                Specs Only <span className="text-slate-400">({specsCount})</span>
                            </button>
                        ) : (
                            <>
                                <button
                                    className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-all duration-200', 
                                        filterMode === FilterMode.All ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                        keyboardNavigatedFilter === FilterMode.All && 'animate-filterGlow')}
                                    onClick={() => setFilterMode(FilterMode.All)}
                                    title="Show all agents"
                                >
                                    All <span className="text-slate-400">({allCount})</span>
                                </button>
                                <button
                                    className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-all duration-200',
                                        filterMode === FilterMode.Spec ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                        keyboardNavigatedFilter === FilterMode.Spec && 'animate-filterGlow')}
                                    onClick={() => setFilterMode(FilterMode.Spec)}
                                    title="Show spec agents"
                                >
                                    Specs <span className="text-slate-400">({specsCount})</span>
                                </button>
                                <button
                                    className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-all duration-200', 
                                        filterMode === FilterMode.Running ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                        keyboardNavigatedFilter === FilterMode.Running && 'animate-filterGlow')}
                                    onClick={() => setFilterMode(FilterMode.Running)}
                                    title="Show running agents"
                                >
                                    Running <span className="text-slate-400">({runningCount})</span>
                                </button>
                                <button
                                    className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-all duration-200', 
                                        filterMode === FilterMode.Reviewed ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50',
                                        keyboardNavigatedFilter === FilterMode.Reviewed && 'animate-filterGlow')}
                                    onClick={() => setFilterMode(FilterMode.Reviewed)}
                                    title="Show reviewed agents"
                                >
                                    Reviewed <span className="text-slate-400">({reviewedCount})</span>
                                </button>
                            </>
                        )}
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
                            onChange={(e) => setSearchQuery(e.target.value)}
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
            <div className="flex-1 overflow-y-auto px-2 pt-2">
                {sessions.length === 0 && !loading ? (
                    <div className="text-center text-slate-500 py-4">
                        {isInSpecMode ? (
                            <div className="flex flex-col items-center gap-3">
                                <div>No specs available</div>
                                <button
                                    onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))}
                                    className="px-3 py-1 text-xs rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
                                >
                                    Create First Spec
                                </button>
                                <button
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('schaltwerk:exit-spec-mode'))
                                        setFilterMode(FilterMode.All)
                                    }}
                                    className="text-xs text-slate-400 hover:text-slate-200"
                                >
                                    View All Sessions
                                </button>
                            </div>
                        ) : (
                            'No active agents'
                        )}
                    </div>
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
                                    hasStuckTerminals={(sessionId: string) => idleByTime.has(sessionId)}
                                    hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                                    isInSpecMode={isInSpecMode}
                                    currentSpecId={specModeState?.currentSpec}
                                    onSelect={(index) => {
                                        // In spec mode, handle spec selection differently
                                        if (isInSpecMode) {
                                            const flattenedSessions = flattenGroupedSessions(sessions)
                                            const session = flattenedSessions[index]
                                            if (session && isSpecSession(session.info)) {
                                                handleSpecClick(session.info.session_id)
                                            } else if (session) {
                                                // Non-spec clicked in spec mode - handle edge case
                                                // Option A: Exit spec mode and select the session
                                                window.dispatchEvent(new CustomEvent('schaltwerk:exit-spec-mode'))
                                                handleSelectSession(index)
                                            }
                                        } else {
                                            handleSelectSession(index)
                                        }
                                    }}
                                    onMarkReady={(sessionId, hasUncommitted) => {
                                        handleMarkReady(sessionId, hasUncommitted)
                                    }}
                                    onUnmarkReady={async (sessionId) => {
                                        try {
                                            await invoke('schaltwerk_core_unmark_session_ready', { name: sessionId })
                                            // Reload both regular and spec sessions to avoid dropping specs
                                            await Promise.all([
                                                invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions'),
                                                invoke<any[]>('schaltwerk_core_list_sessions_by_state', { state: 'spec' })
                                            ])
                                            await reloadSessions()
                                        } catch (err) {
                                            logger.error('Failed to unmark reviewed session:', err)
                                        }
                                    }}
                                    onCancel={(sessionId, hasUncommitted) => {
                                        const session = sessions.find(s => s.info.session_id === sessionId)
                                        if (session) {
                                            window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                                                detail: {
                                                    action: 'cancel',
                                                    sessionId,
                                                    sessionName: sessionId,
                                                    sessionDisplayName: session.info.display_name || session.info.session_id,
                                                    branch: session.info.branch,
                                                    hasUncommittedChanges: hasUncommitted
                                                }
                                            }))
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
                                                sessionDisplayName: session.info.display_name || session.info.session_id,
                                                hasUncommitted: session.info.has_uncommitted_changes || false
                                            })
                                        }
                                    }}
                                    onRunDraft={async (sessionId) => {
                                        try {
                                            // Open Start agent modal prefilled from spec
                                            window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionId } }))
                                        } catch (err) {
                                            logger.error('Failed to open start modal from spec:', err)
                                        }
                                    }}
                                    onDeleteSpec={async (sessionId) => {
                                        try {
                                            await invoke('schaltwerk_core_cancel_session', { name: sessionId })
                                            // Reload both regular and spec sessions to ensure remaining specs persist
                                            await Promise.all([
                                                invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions'),
                                                invoke<any[]>('schaltwerk_core_list_sessions_by_state', { state: 'spec' })
                                            ])
                                            await reloadSessions()
                                        } catch (err) {
                                            logger.error('Failed to delete spec:', err)
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
                                    isResetting={isResetting}
                                    isSessionRunning={isSessionRunning}
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
                    await reloadSessions()
                }}
            />
            <ConvertToSpecConfirmation
                open={convertToSpecModal.open}
                sessionName={convertToSpecModal.sessionName}
                sessionDisplayName={convertToSpecModal.sessionDisplayName}
                hasUncommittedChanges={convertToSpecModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    await reloadSessions()
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
            <SwitchOrchestratorModal
                open={switchOrchestratorModal}
                onClose={() => {
                    setSwitchOrchestratorModal(false)
                    setSwitchModelSessionId(null)
                }}
                onSwitch={async (agentType) => {
                    // Determine which session/orchestrator to switch model for
                    const targetSelection = switchModelSessionId 
                        ? { kind: 'session' as const, payload: switchModelSessionId }
                        : selection
                    
                    await switchModel(agentType, targetSelection, terminals, clearTerminalTracking, clearTerminalStartedTracking)
                    
                    // Reload sessions to show updated agent type
                    await reloadSessions()
                    
                    setSwitchOrchestratorModal(false)
                    setSwitchModelSessionId(null)
                }}
            />
        </div>
    )
}
