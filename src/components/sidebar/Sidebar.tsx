import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useSelection } from '../../contexts/SelectionContext'
import { useSessions } from '../../contexts/SessionsContext'
import { useSortedSessions } from '../../hooks/useSortedSessions'
import { useProject } from '../../contexts/ProjectContext'
import { computeNextSelectedSessionId } from '../../utils/selectionNext'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { ConvertToDraftConfirmation } from '../modals/ConvertToDraftConfirmation'
import { SessionButton } from './SessionButton'
import { FilterMode, SortMode, isValidFilterMode, isValidSortMode, getDefaultFilterMode, getDefaultSortMode } from '../../types/sessionFilters'
import { SessionHints } from '../hints/SessionHints'

// Normalize backend states to UI categories
function mapSessionUiState(info: SessionInfo): 'draft' | 'running' | 'reviewed' {
    if (info.session_state === 'draft' || info.status === 'draft') return 'draft'
    if (info.ready_to_merge) return 'reviewed'
    return 'running'
}

function isDraft(info: SessionInfo): boolean { return mapSessionUiState(info) === 'draft' }
function isReviewed(info: SessionInfo): boolean { return mapSessionUiState(info) === 'reviewed' }

interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

interface SessionInfo {
    session_id: string
    display_name?: string  // Human-friendly name generated from prompt
    branch: string
    worktree_path: string
    base_branch: string
    merge_mode: string
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'draft'
    created_at?: string
    last_modified?: string
    has_uncommitted_changes?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    // Monitor fields
    session_state?: string
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
    ready_to_merge?: boolean
}

interface EnrichedSession {
    info: SessionInfo
    status?: any // Additional status if available
    terminals: string[]
}


// Removed legacy terminal-stuck idle handling; we rely on last-edited timestamps only

interface FollowUpMessageNotification {
    session_name: string
    message: string
    message_type: string
    timestamp: number
    terminal_id: string
}

interface SidebarProps {
    isDiffViewerOpen?: boolean
}

export function Sidebar({ isDiffViewerOpen }: SidebarProps) {
    const { selection, setSelection } = useSelection()
    const { projectPath } = useProject()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const [filterMode, setFilterMode] = useState<FilterMode>(getDefaultFilterMode())
    const [sortMode, setSortMode] = useState<SortMode>(getDefaultSortMode())
    const { sessions: contextSessions, reloadSessions } = useSessions()
    const { sessions: sortedSessions, loading: sortedLoading } = useSortedSessions({ sortMode, filterMode })
    // loading is provided by SessionsContext
    const [settingsLoaded, setSettingsLoaded] = useState(false)
    // Removed: stuckTerminals; idle is computed from last edit timestamps
    const [sessionsWithNotifications, setSessionsWithNotifications] = useState<Set<string>>(new Set())
    const [idleByTime, setIdleByTime] = useState<Set<string>>(new Set())
    const [markReadyModal, setMarkReadyModal] = useState<{ open: boolean; sessionName: string; hasUncommitted: boolean }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
    const [convertToDraftModal, setConvertToDraftModal] = useState<{ 
        open: boolean; 
        sessionName: string; 
        sessionDisplayName?: string;
        hasUncommitted: boolean 
    }>({
        open: false,
        sessionName: '',
        hasUncommitted: false
    })
    const sidebarRef = useRef<HTMLDivElement>(null)
    const isProjectSwitching = useRef(false)
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
    
    // Use backend-sorted sessions directly
    const sessions = sortedSessions
    const loading = sortedLoading
    
    // Load settings when project changes
    useEffect(() => {
        if (!projectPath) return
        
        const loadProjectSettings = async () => {
            try {
                const settings = await invoke<{ filter_mode: string; sort_mode: string }>('get_project_sessions_settings')
                if (settings) {
                    // Validate and set filter mode with fallback
                    const filterMode = isValidFilterMode(settings.filter_mode) 
                        ? settings.filter_mode as FilterMode
                        : getDefaultFilterMode()
                    setFilterMode(filterMode)
                    
                    // Validate and set sort mode with fallback
                    const sortMode = isValidSortMode(settings.sort_mode)
                        ? settings.sort_mode as SortMode
                        : getDefaultSortMode()
                    setSortMode(sortMode)
                    
                    setSettingsLoaded(true)
                }
            } catch (error) {
                console.warn('Failed to load project sessions settings:', error)
                setSettingsLoaded(true)
            }
        }
        
        loadProjectSettings()
    }, [projectPath])
    
    // Auto-select first visible session when current selection disappears from view
    useEffect(() => {
        // Skip auto-selection during project switches to avoid conflicts with restoration
        if (isProjectSwitching.current) return
        
        if (selection.kind !== 'session') return
        
        const currentSessionVisible = sessions.some(s => s.info.session_id === selection.payload)
        
        if (!currentSessionVisible) {
            if (sessions.length > 0) {
                // Current selection is not visible anymore, select the first visible session
                const firstSession = sessions[0]
                setSelection({
                    kind: 'session',
                    payload: firstSession.info.session_id,
                    worktreePath: firstSession.info.worktree_path,
                    sessionState: mapSessionUiState(firstSession.info)
                }, false, false) // Auto-selection - not intentional
            } else {
                // No sessions visible, select orchestrator
                setSelection({ kind: 'orchestrator' }, false, false) // Auto-selection - not intentional
            }
        }
    }, [sessions, selection, setSelection])

    // Compute time-based idle sessions from last activity
    useEffect(() => {
        const recomputeIdle = () => {
            const now = Date.now()
            const next = new Set<string>()
            for (const s of contextSessions) {
                const ts: number | undefined = (s.info as any).last_modified_ts
                const draft = isDraft(s.info)
                const reviewed = isReviewed(s.info)
                if (typeof ts === 'number' && !draft && !reviewed && now - ts >= IDLE_THRESHOLD_MS) {
                    next.add(s.info.session_id)
                }
            }
            setIdleByTime(next)
        }

        // Run immediately and then every 30s
        recomputeIdle()
        const t = setInterval(recomputeIdle, 30_000)
        return () => clearInterval(t)
    }, [contextSessions])

    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator' }, false, true) // User clicked - intentional
    }
    

    const handleSelectSession = async (index: number) => {
        const session = sessions[index]
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
                // Check if it's a draft
                if (isDraft(selectedSession.info)) {
                    // For drafts, always show confirmation dialog (ignore immediate flag)
                    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
                        detail: {
                            action: 'delete-draft',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName: selectedSession.info.display_name || selectedSession.info.session_id,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: false // Drafts don't have uncommitted changes
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
        if (selection.kind === 'session') {
            const currentIndex = sessions.findIndex(s => s.info.session_id === selection.payload)
            // If at the first session, go to orchestrator
            if (currentIndex <= 0) {
                await handleSelectOrchestrator()
                return
            }
            await handleSelectSession(currentIndex - 1)
            return
        }
        // If orchestrator is selected, do nothing on ArrowUp
    }

    const selectNext = async () => {
        if (sessions.length === 0) return
        if (selection.kind === 'orchestrator') {
            // From orchestrator, go to the first session
            await handleSelectSession(0)
            return
        }
        if (selection.kind === 'session') {
            const currentIndex = sessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, sessions.length - 1)
            if (nextIndex !== currentIndex) {
                await handleSelectSession(nextIndex)
            }
            return
        }
    }

    const handleMarkSelectedSessionReady = () => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !selectedSession.info.ready_to_merge) {
                setMarkReadyModal({
                    open: true,
                    sessionName: selectedSession.info.session_id,
                    hasUncommitted: selectedSession.info.has_uncommitted_changes || false
                })
            }
        }
    }

    useKeyboardShortcuts({
        onSelectOrchestrator: handleSelectOrchestrator,
        onSelectSession: handleSelectSession,
        onCancelSelectedSession: handleCancelSelectedSession,
        onMarkSelectedSessionReady: handleMarkSelectedSessionReady,
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
            // Only open if a session is selected
            if (selection.kind !== 'session') return
            window.dispatchEvent(new CustomEvent('schaltwerk:open-diff-view'))
        },
        onFocusTerminal: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
            window.dispatchEvent(new CustomEvent('schaltwerk:focus-terminal'))
        },
        isDiffViewerOpen
    })

    // Persist user preferences to backend
    useEffect(() => {
        if (!settingsLoaded || !projectPath) return
        
        const saveSettings = async () => {
            try {
                await invoke('set_project_sessions_settings', { 
                    settings: {
                        filter_mode: filterMode,
                        sort_mode: sortMode
                    }
                })
            } catch (error) {
                console.warn('Failed to save sessions settings:', error)
            }
        }
        
        saveSettings()
    }, [filterMode, sortMode, settingsLoaded, projectPath])

    // Sessions are now managed by SessionsContext
    
    // Sessions refresh handling moved into SessionsContext
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        const handler = () => handleMarkSelectedSessionReady()
        window.addEventListener('global-mark-ready-shortcut', handler as any)
        return () => window.removeEventListener('global-mark-ready-shortcut', handler as any)
    }, [selection, sessions])

    // Selection is now restored by SelectionContext itself

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSelectionRef = useRef(selection)
    const latestSortedSessionsRef = useRef(sessions)
    const latestFilterModeRef = useRef(filterMode)
    const latestSessionsRef = useRef(contextSessions)

    useEffect(() => { latestSelectionRef.current = selection }, [selection])
    useEffect(() => { latestSortedSessionsRef.current = sessions }, [sessions])
    useEffect(() => { latestFilterModeRef.current = filterMode }, [filterMode])
    useEffect(() => { latestSessionsRef.current = contextSessions }, [contextSessions])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let unlisteners: UnlistenFn[] = []

        const attach = async () => {
            // Activity and git stats updates are handled by SessionsContext

            // Session added
            const u3 = await listen<{
                session_name: string
                branch: string
                worktree_path: string
                parent_branch: string
            }>('schaltwerk:session-added', (event) => {
                const { session_name, worktree_path } = event.payload
                // Auto-select the newly created session tab immediately
                if (latestFilterModeRef.current === FilterMode.Draft) {
                    setFilterMode(FilterMode.Running)
                }
                setSelection({ 
                    kind: 'session', 
                    payload: session_name,
                    worktreePath: worktree_path,
                    sessionState: 'running' // New sessions are always running, not draft
                }, false, true) // Backend requested - intentional
            })
            unlisteners.push(u3)

            // Session removed
            const u4 = await listen<{ session_name: string }>('schaltwerk:session-removed', async (event) => {
                const { session_name } = event.payload
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
                        await setSelection({ kind: 'orchestrator' }, false, false) // Fallback - not intentional
                    }
                }
            })
            unlisteners.push(u4)
            
            // Listen for follow-up message notifications
            const u5 = await listen<FollowUpMessageNotification>('schaltwerk:follow-up-message', (event) => {
                const { session_name, message, message_type } = event.payload
                
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
                console.log(`📬 Follow-up message for ${session_name}: ${message}`)
                
                // For now, just log the message - in the future we could show toast notifications
                if (message_type === 'system') {
                    console.log(`📢 System message for session ${session_name}: ${message}`)
                } else {
                    console.log(`💬 User message for session ${session_name}: ${message}`)
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
                    console.warn('Failed to unlisten sidebar event', e)
                }
            })
        }
    // Attach once on mount; use refs above for latest values inside handlers
    }, [setSelection])

    return (
        <div ref={sidebarRef} className="h-full flex flex-col">
            <div className="h-8 px-3 border-b border-slate-800 text-xs flex items-center text-slate-300">Repository (Orchestrator)</div>
            <div className="px-2 pt-2">
                <button
                    onClick={handleSelectOrchestrator}
                    className={clsx('w-full text-left px-3 py-2 rounded-md mb-1 group', selection.kind === 'orchestrator' ? 'bg-slate-800/60 session-ring session-ring-blue' : 'hover:bg-slate-800/30')}
                    title="Select orchestrator (⌘1)"
                >
                    <div className="flex items-center justify-between">
                        <div className="font-medium text-slate-100">main (orchestrator)</div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">⌘1</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">main repo</span>
                    </div>
                    </div>
                    <div className="text-xs text-slate-500">Original repository from which sessions are created</div>
                </button>
            </div>

            <div className="h-8 px-3 border-t border-b border-slate-800 text-xs text-slate-300 flex items-center">
                <div className="flex items-center gap-2 w-full">
                    <span className="text-xs flex-shrink-0">Tasks</span>
                    <div className="flex items-center gap-1 ml-auto flex-nowrap overflow-x-auto">
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === FilterMode.All ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode(FilterMode.All)}
                            title="Show all tasks"
                        >
                            All <span className="text-slate-400">({contextSessions.length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === FilterMode.Draft ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode(FilterMode.Draft)}
                            title="Show draft tasks"
                        >
                            Drafts <span className="text-slate-400">({contextSessions.filter(s => isDraft(s.info)).length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === FilterMode.Running ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode(FilterMode.Running)}
                            title="Show running tasks"
                        >
                            Running <span className="text-slate-400">({contextSessions.filter(s => !isReviewed(s.info) && !isDraft(s.info)).length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === FilterMode.Reviewed ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode(FilterMode.Reviewed)}
                            title="Show reviewed tasks"
                        >
                            Reviewed <span className="text-slate-400">({contextSessions.filter(s => isReviewed(s.info)).length})</span>
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
            <div className="flex-1 overflow-y-auto px-2 pt-2">
                {loading ? (
                    <div className="text-center text-slate-500 py-4">Loading tasks...</div>
                ) : sessions.length === 0 ? (
                    <div className="text-center text-slate-500 py-4">No active tasks</div>
                ) : (
                    sessions.map((session, i) => {
                        const isSelected = selection.kind === 'session' && selection.payload === session.info.session_id
                        const hasStuckTerminals = idleByTime.has(session.info.session_id)
                        const hasFollowUpMessage = sessionsWithNotifications.has(session.info.session_id)

                        return (
                            <SessionButton
                                key={`c-${session.info.session_id}`}
                                session={session}
                                index={i}
                                isSelected={isSelected}
                                hasStuckTerminals={hasStuckTerminals}
                                hasFollowUpMessage={hasFollowUpMessage}
                                onSelect={handleSelectSession}
                                onMarkReady={(sessionId, hasUncommitted) => {
                                    setMarkReadyModal({
                                        open: true,
                                        sessionName: sessionId,
                                        hasUncommitted
                                    })
                                }}
                                onUnmarkReady={async (sessionId) => {
                                    try {
                                        await invoke('para_core_unmark_session_ready', { name: sessionId })
                                        // Reload both regular and draft sessions to avoid dropping drafts
                                        await Promise.all([
                                            invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                                            invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                                        ])
                                        await reloadSessions()
                                    } catch (err) {
                                        console.error('Failed to unmark reviewed session:', err)
                                    }
                                }}
                                onCancel={(sessionId, hasUncommitted) => {
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
                                }}
                                onConvertToDraft={(sessionId) => {
                                    // Open confirmation modal
                                    setConvertToDraftModal({
                                        open: true,
                                        sessionName: sessionId,
                                        sessionDisplayName: session.info.display_name || session.info.session_id,
                                        hasUncommitted: session.info.has_uncommitted_changes || false
                                    })
                                }}
                                onRunDraft={async (sessionId) => {
                                    try {
                                        // Open Start task modal prefilled from draft
                                        window.dispatchEvent(new CustomEvent('schaltwerk:start-task-from-draft', { detail: { name: sessionId } }))
                                    } catch (err) {
                                        console.error('Failed to open start modal from draft:', err)
                                    }
                                }}
                                onDeleteDraft={async (sessionId) => {
                                    try {
                                        await invoke('para_core_cancel_session', { name: sessionId })
                                        // Reload both regular and draft sessions to ensure remaining drafts persist
                                        await Promise.all([
                                            invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                                            invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                                        ])
                                        await reloadSessions()
                                    } catch (err) {
                                        console.error('Failed to delete draft:', err)
                                    }
                                }}
                            />
                        )
                    })
                )}
            </div>
            
            {/* Context-aware hints */}
            <div className="border-t border-slate-800">
                <SessionHints />
            </div>
            
            <MarkReadyConfirmation
                open={markReadyModal.open}
                sessionName={markReadyModal.sessionName}
                hasUncommittedChanges={markReadyModal.hasUncommitted}
                onClose={() => setMarkReadyModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    // Reload both regular and draft sessions
                    await reloadSessions()
                }}
            />
            <ConvertToDraftConfirmation
                open={convertToDraftModal.open}
                sessionName={convertToDraftModal.sessionName}
                sessionDisplayName={convertToDraftModal.sessionDisplayName}
                hasUncommittedChanges={convertToDraftModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    await reloadSessions()
                }}
            />
        </div>
    )
}
