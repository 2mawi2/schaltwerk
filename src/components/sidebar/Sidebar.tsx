import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { computeNextSelectedSessionId } from '../../utils/selectionNext'
import { MarkReadyConfirmation } from '../modals/MarkReadyConfirmation'
import { ConvertToDraftConfirmation } from '../modals/ConvertToDraftConfirmation'
import { SessionButton } from './SessionButton'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'
import { clearTerminalStartedTracking } from '../terminal/Terminal'

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
    const { selection, setSelection, clearTerminalTracking, terminals } = useSelection()
    const { projectPath } = useProject()
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [filterMode, setFilterMode] = useState<'all' | 'draft' | 'running' | 'reviewed'>(() => {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('schaltwerk:sessions:filterMode') : null
        return (saved === 'draft' || saved === 'running' || saved === 'reviewed') ? saved : 'all'
    })
    const [sortMode, setSortMode] = useState<'name' | 'created' | 'last-edited'>(() => {
        if (typeof window === 'undefined') return 'name'
        
        try {
            const saved = window.localStorage.getItem('schaltwerk:sessions:sortMode')
            if (saved === 'name' || saved === 'created' || saved === 'last-edited') {
                return saved
            }
        } catch (error) {
            console.warn('Failed to load sort mode from localStorage:', error)
        }
        
        return 'name'
    })
    const [loading, setLoading] = useState(true)
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
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState(false)
    const sidebarRef = useRef<HTMLDivElement>(null)
    const previousProjectPath = useRef<string | null>(null)
    const isProjectSwitching = useRef(false)
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
    
    // Extract sorting logic
    const applySortMode = useCallback((sessionList: EnrichedSession[], mode: typeof sortMode) => {
        switch (mode) {
            case 'last-edited':
                // Sort by last modified time (most recent first)
                return [...sessionList].sort((a, b) => {
                    const aTime = a.info.last_modified ? new Date(a.info.last_modified).getTime() : 0
                    const bTime = b.info.last_modified ? new Date(b.info.last_modified).getTime() : 0
                    return bTime - aTime // Most recent first
                })
            case 'created':
                // Sort by creation time (newest first)
                return [...sessionList].sort((a, b) => {
                    const aTime = a.info.created_at ? new Date(a.info.created_at).getTime() : 0
                    const bTime = b.info.created_at ? new Date(b.info.created_at).getTime() : 0
                    
                    // If both have creation times, sort newest first
                    if (aTime && bTime) {
                        return bTime - aTime
                    }
                    // If only one has creation time, it comes first
                    if (aTime) return -1
                    if (bTime) return 1
                    // Otherwise alphabetical
                    return a.info.session_id.localeCompare(b.info.session_id)
                })
            case 'name':
            default:
                // Alphabetical sort by session_id
                return [...sessionList].sort((a, b) => 
                    a.info.session_id.localeCompare(b.info.session_id)
                )
        }
    }, [])
    
    // Detect project changes
    useEffect(() => {
        if (previousProjectPath.current !== null && previousProjectPath.current !== projectPath) {
            // Project is changing
            isProjectSwitching.current = true
            // Reset flag after a short delay to allow restoration to complete
            setTimeout(() => {
                isProjectSwitching.current = false
            }, 500)
        }
        previousProjectPath.current = projectPath
    }, [projectPath])
    
    // Memoize displayed sessions (filter + sort) to prevent re-computation on every render
    const sortedSessions = useMemo(() => {
        let filtered = sessions
        if (filterMode === 'draft') {
            filtered = sessions.filter(s => s.info.session_state === 'draft' || s.info.status === 'draft')
        } else if (filterMode === 'running') {
            filtered = sessions.filter(s => !s.info.ready_to_merge && s.info.session_state !== 'draft' && s.info.status !== 'draft')
        } else if (filterMode === 'reviewed') {
            filtered = sessions.filter(s => !!s.info.ready_to_merge)
        }
        
        // Separate reviewed and unreviewed
        const reviewed = filtered.filter(s => s.info.ready_to_merge)
        const unreviewed = filtered.filter(s => !s.info.ready_to_merge)
        
        // Apply sorting to each group
        const sortedUnreviewed = applySortMode(unreviewed, sortMode)
        const sortedReviewed = applySortMode(reviewed, 'name') // Always sort reviewed by name
        
        // Unreviewed on top, reviewed at bottom
        return [...sortedUnreviewed, ...sortedReviewed]
    }, [sessions, filterMode, sortMode, applySortMode])
    
    // Auto-select first visible session when current selection disappears from view
    useEffect(() => {
        // Skip auto-selection during project switches to avoid conflicts with restoration
        if (isProjectSwitching.current) return
        
        if (selection.kind !== 'session') return
        
        const currentSessionVisible = sortedSessions.some(s => s.info.session_id === selection.payload)
        
        if (!currentSessionVisible) {
            if (sortedSessions.length > 0) {
                // Current selection is not visible anymore, select the first visible session
                const firstSession = sortedSessions[0]
                setSelection({
                    kind: 'session',
                    payload: firstSession.info.session_id,
                    worktreePath: firstSession.info.worktree_path,
                    sessionState: firstSession.info.session_state as 'draft' | 'running' | 'reviewed' | undefined
                }, false, false) // Auto-selection - not intentional
            } else {
                // No sessions visible, select orchestrator
                setSelection({ kind: 'orchestrator' }, false, false) // Auto-selection - not intentional
            }
        }
    }, [sortedSessions, selection, setSelection])

    // Compute time-based idle sessions from last activity
    useEffect(() => {
        const recomputeIdle = () => {
            const now = Date.now()
            const next = new Set<string>()
            for (const s of sessions) {
                const ts: number | undefined = (s.info as any).last_modified_ts
                const isDraft = s.info.session_state === 'draft' || s.info.status === 'draft'
                const isReviewed = !!s.info.ready_to_merge
                if (typeof ts === 'number' && !isDraft && !isReviewed && now - ts >= IDLE_THRESHOLD_MS) {
                    next.add(s.info.session_id)
                }
            }
            setIdleByTime(next)
        }

        // Run immediately and then every 30s
        recomputeIdle()
        const t = setInterval(recomputeIdle, 30_000)
        return () => clearInterval(t)
    }, [sessions])

    const handleSelectOrchestrator = async () => {
        await setSelection({ kind: 'orchestrator' }, false, true) // User clicked - intentional
    }

    const handleSelectSession = async (index: number) => {
        const session = sortedSessions[index]
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
                sessionState: s.session_state as 'draft' | 'running' | 'reviewed' | undefined
            }, false, true) // User clicked - intentional
        }
    }

    const handleCancelSelectedSession = (immediate: boolean) => {
        if (selection.kind === 'session') {
            const selectedSession = sortedSessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession) {
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

    const selectPrev = async () => {
        if (sortedSessions.length === 0) return
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
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
        if (sortedSessions.length === 0) return
        if (selection.kind === 'orchestrator') {
            // From orchestrator, go to the first session
            await handleSelectSession(0)
            return
        }
        if (selection.kind === 'session') {
            const currentIndex = sortedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, sortedSessions.length - 1)
            if (nextIndex !== currentIndex) {
                await handleSelectSession(nextIndex)
            }
            return
        }
    }

    const handleMarkSelectedSessionReady = () => {
        if (selection.kind === 'session') {
            const selectedSession = sortedSessions.find(s => s.info.session_id === selection.payload)
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
        sessionCount: sortedSessions.length,
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

    // Persist user preferences
    useEffect(() => {
        try { window.localStorage.setItem('schaltwerk:sessions:filterMode', filterMode) } catch {}
    }, [filterMode])
    
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('schaltwerk:sessions:sortMode', sortMode)
            }
        } catch (error) {
            console.warn('Failed to save sort mode to localStorage:', error)
        }
    }, [sortMode])

    // Load sessions on mount and when project changes; push updates keep it fresh thereafter
    useEffect(() => {
        console.log('[Sidebar] Project path changed, reloading sessions for:', projectPath)
        const loadSessions = async () => {
            try {
                // Load both regular sessions and drafts
                const [regularSessions, draftSessions] = await Promise.all([
                    invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                    invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                ])
                
                // Convert draft sessions to EnrichedSession format
                const enrichedDrafts: EnrichedSession[] = draftSessions.map(draft => ({
                    id: draft.id,
                    info: {
                        session_id: draft.name,
                        display_name: draft.display_name || draft.name,
                        branch: draft.branch,
                        worktree_path: draft.worktree_path || '',
                        base_branch: draft.parent_branch,
                        merge_mode: 'rebase',
                        status: 'draft' as any,
                        session_state: 'draft',
                        created_at: new Date(draft.created_at).toISOString(),
                        last_modified: draft.updated_at ? new Date(draft.updated_at).toISOString() : new Date(draft.created_at).toISOString(),
                        has_uncommitted_changes: false,
                        ready_to_merge: false,
                        diff_stats: undefined,
                        is_current: false,
                        session_type: 'worktree' as any,
                    },
                    terminals: [
                        `session-${draft.name}-top`,
                        `session-${draft.name}-bottom`
                    ]
                }))
                
                // Combine and set all sessions
                const allSessions = [...regularSessions, ...enrichedDrafts]
                setSessions(allSessions.map(s => ({
                    ...s,
                    info: {
                        ...s.info,
                        last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                    }
                })))
                // Initialize previous states snapshot for transition detection
                const nextStates = new Map<string, string>()
                for (const s of allSessions) {
                    const state = (s.info.session_state || s.info.status || 'active') as string
                    nextStates.set(s.info.session_id, state)
                }
                prevSessionStatesRef.current = nextStates
            } catch (err) {
                console.error('Failed to load sessions:', err)
            } finally {
                setLoading(false)
            }
        }

        loadSessions()
    }, [projectPath]) // Reload sessions when project path changes
    
    // Listen for sessions-refreshed events (e.g., after name generation)
    useEffect(() => {
        const setupRefreshListener = async () => {
            const unlisten = await listen<EnrichedSession[]>('schaltwerk:sessions-refreshed', async (event) => {
                try {
                    // If we received a payload, treat it as the authoritative list of non-draft sessions.
                    // Always merge in the current drafts to avoid dropping them.
                    const baseSessions: EnrichedSession[] = (event.payload && event.payload.length > 0)
                        ? event.payload
                        : await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')

                    const draftSessions = await invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                    const enrichedDrafts: EnrichedSession[] = draftSessions.map(draft => ({
                        id: draft.id,
                        info: {
                            session_id: draft.name,
                            display_name: draft.display_name || draft.name,
                            branch: draft.branch,
                            worktree_path: draft.worktree_path || '',
                            base_branch: draft.parent_branch,
                            merge_mode: 'rebase',
                            status: 'draft' as any,
                            session_state: 'draft',
                            created_at: new Date(draft.created_at).toISOString(),
                            last_modified: draft.updated_at ? new Date(draft.updated_at).toISOString() : new Date(draft.created_at).toISOString(),
                            has_uncommitted_changes: false,
                            ready_to_merge: false,
                            diff_stats: undefined,
                            is_current: false,
                            session_type: 'worktree' as any,
                        },
                        terminals: [
                            `session-${draft.name}-top`,
                            `session-${draft.name}-bottom`
                        ]
                    }))

                    const allSessions = [...baseSessions, ...enrichedDrafts]

                    // Detect draft -> running transitions
                    const prevStates = prevSessionStatesRef.current
                    const transitioned = allSessions.filter(s => {
                        const prev = prevStates.get(s.info.session_id)
                        const nowState = (s.info.session_state || s.info.status || 'active') as string
                        return prev === 'draft' && nowState !== 'draft'
                    })

                    if (transitioned.length > 0) {
                        const t = transitioned[0]
                        if (latestFilterModeRef.current === 'draft') {
                            setFilterMode('running')
                        }
                        setSelection({
                            kind: 'session',
                            payload: t.info.session_id,
                            worktreePath: t.info.worktree_path,
                            sessionState: t.info.session_state as 'draft' | 'running' | 'reviewed' | undefined
                        }, false, false) // Auto-select on state transition - not intentional
                    }

                    setSessions(allSessions.map(s => ({
                        ...s,
                        info: {
                            ...s.info,
                            last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                        }
                    })))

                    // Update snapshot of states
                    const nextStates = new Map<string, string>()
                    for (const s of allSessions) {
                        const state = (s.info.session_state || s.info.status || 'active') as string
                        nextStates.set(s.info.session_id, state)
                    }
                    prevSessionStatesRef.current = nextStates
                } catch (err) {
                    console.error('Failed to reload sessions:', err)
                }
            })

            return () => {
                unlisten()
            }
        }

        const cleanup = setupRefreshListener()
        return () => {
            cleanup.then(fn => fn())
        }
    }, [])
    
    // Global shortcut from terminal for Mark Reviewed (⌘R)
    useEffect(() => {
        const handler = () => handleMarkSelectedSessionReady()
        window.addEventListener('global-mark-ready-shortcut', handler as any)
        return () => window.removeEventListener('global-mark-ready-shortcut', handler as any)
    }, [selection, sortedSessions])

    // Selection is now restored by SelectionContext itself

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSelectionRef = useRef(selection)
    const latestSortedSessionsRef = useRef(sortedSessions)
    const latestFilterModeRef = useRef(filterMode)
    const prevSessionStatesRef = useRef<Map<string, string>>(new Map())

    useEffect(() => { latestSelectionRef.current = selection }, [selection])
    useEffect(() => { latestSortedSessionsRef.current = sortedSessions }, [sortedSessions])
    useEffect(() => { latestFilterModeRef.current = filterMode }, [filterMode])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let unlisteners: UnlistenFn[] = []

        const attach = async () => {
            // Activity updates (last_modified)
            const u1 = await listen<{
                session_id: string
                session_name: string
                last_activity_ts: number
            }>('schaltwerk:session-activity', (event) => {
                const { session_name, last_activity_ts } = event.payload
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            last_modified: new Date(last_activity_ts * 1000).toISOString(),
                            last_modified_ts: last_activity_ts * 1000,
                        }
                    }
                }))
            })
            unlisteners.push(u1)
            
            // Git stats updates
            const u2 = await listen<{
                session_id: string
                session_name: string
                files_changed: number
                lines_added: number
                lines_removed: number
                has_uncommitted: boolean
            }>('schaltwerk:session-git-stats', (event) => {
                const { session_name, files_changed, lines_added, lines_removed, has_uncommitted } = event.payload
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    const diff = {
                        files_changed: files_changed || 0,
                        additions: lines_added || 0,
                        deletions: lines_removed || 0,
                        insertions: lines_added || 0,
                    }
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            diff_stats: diff,
                            has_uncommitted_changes: has_uncommitted,
                        }
                    }
                }))
            })
            unlisteners.push(u2)

            // Session added
            const u3 = await listen<{
                session_name: string
                branch: string
                worktree_path: string
                parent_branch: string
            }>('schaltwerk:session-added', (event) => {
                const { session_name, branch, worktree_path, parent_branch } = event.payload
                setSessions(prev => {
                    // Avoid duplicates
                    if (prev.some(s => s.info.session_id === session_name)) return prev
                    const info: SessionInfo = {
                        session_id: session_name,
                        branch,
                        worktree_path,
                        base_branch: parent_branch,
                        merge_mode: 'rebase',
                        status: 'active',
                        last_modified: undefined,
                        has_uncommitted_changes: false,
                        is_current: false,
                        session_type: 'worktree',
                        container_status: undefined,
                        session_state: 'active',
                        current_task: undefined,
                        todo_percentage: undefined,
                        is_blocked: undefined,
                        diff_stats: undefined,
                        ready_to_merge: false,
                    }
                    const terminals = [
                        `session-${session_name}-top`,
                        `session-${session_name}-bottom`,
                    ]
                    const enriched: EnrichedSession = { info, status: undefined, terminals }
                    // Add new session without re-sorting - will be sorted by memo
                    return [enriched, ...prev]
                })
                // Auto-select the newly created session tab immediately
                if (latestFilterModeRef.current === 'draft') {
                    setFilterMode('running')
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

                setSessions(prev => prev.filter(s => s.info.session_id !== session_name))

                if (currentSelectedId === session_name) {
                    if (nextSelectionId) {
                        const nextSession = sortedSessions.find(s => s.info.session_id === nextSelectionId)
                        await setSelection({ 
                            kind: 'session', 
                            payload: nextSelectionId,
                            worktreePath: nextSession?.info.worktree_path,
                            sessionState: nextSession?.info.session_state as 'draft' | 'running' | 'reviewed' | undefined
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
                setSessions(prev => {
                    const session = prev.find(s => s.info.session_id === session_name)
                    if (session) {
                        // Focus the session when review content is pasted, including worktree path
                        setSelection({
                            kind: 'session',
                            payload: session_name,
                            worktreePath: session.info.worktree_path,
                            sessionState: session.info.session_state as 'draft' | 'running' | 'reviewed' | undefined
                        }, false, true) // Backend requested - intentional
                        
                        // Set Claude focus for the session
                        setFocusForSession(session_name, 'claude')
                        setCurrentFocus('claude')
                    }
                    return prev
                })
                
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
                <button
                    onClick={() => setSwitchOrchestratorModal(true)}
                    className="w-full text-left px-3 py-1.5 rounded-md mb-2 hover:bg-slate-800/30 group"
                    title="Switch orchestrator model"
                >
                    <div className="flex items-center gap-2 text-xs">
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span className="text-slate-400">Switch Model</span>
                    </div>
                </button>
            </div>

            <div className="h-8 px-3 border-t border-b border-slate-800 text-xs text-slate-300 flex items-center">
                <div className="flex items-center gap-2 w-full">
                    <span className="text-xs flex-shrink-0">Tasks</span>
                    <div className="flex items-center gap-1 ml-auto flex-nowrap overflow-x-auto">
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === 'all' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode('all')}
                            title="Show all tasks"
                        >
                            All <span className="text-slate-400">({sessions.length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === 'draft' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode('draft')}
                            title="Show draft tasks"
                        >
                            Drafts <span className="text-slate-400">({sessions.filter(s => s.info.session_state === 'draft' || s.info.status === 'draft').length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === 'running' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode('running')}
                            title="Show running tasks"
                        >
                            Running <span className="text-slate-400">({sessions.filter(s => !s.info.ready_to_merge && s.info.session_state !== 'draft' && s.info.status !== 'draft').length})</span>
                        </button>
                        <button
                            className={clsx('text-[10px] px-2 py-0.5 rounded flex items-center gap-1', 
                                filterMode === 'reviewed' ? 'bg-slate-700/60 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/50')}
                            onClick={() => setFilterMode('reviewed')}
                            title="Show reviewed tasks"
                        >
                            Reviewed <span className="text-slate-400">({sessions.filter(s => !!s.info.ready_to_merge).length})</span>
                        </button>
                        <button
                            className="px-1.5 py-0.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white flex items-center gap-0.5 flex-shrink-0"
                            onClick={() => {
                                // Cycle through: name -> created -> last-edited -> name
                                const nextMode = sortMode === 'name' ? 'created' : 
                                               sortMode === 'created' ? 'last-edited' : 'name'
                                setSortMode(nextMode)
                            }}
                            title={`Sort: ${sortMode === 'name' ? 'Name (A-Z)' : sortMode === 'created' ? 'Creation Time' : 'Last Edited'}`}
                        >
                            {/* Sort icon - compact */}
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                            {/* Compact text indicator */}
                            <span className="text-[9px] font-medium leading-none w-6 text-left">
                                {sortMode === 'name' ? 'A-Z' : sortMode === 'created' ? 'New' : 'Edit'}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pt-2">
                {loading ? (
                    <div className="text-center text-slate-500 py-4">Loading tasks...</div>
                ) : sortedSessions.length === 0 ? (
                    <div className="text-center text-slate-500 py-4">No active tasks</div>
                ) : (
                    sortedSessions.map((session, i) => {
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
                                        const [regularSessions, draftSessions] = await Promise.all([
                                            invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                                            invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                                        ])
                                        const enrichedDrafts: EnrichedSession[] = draftSessions.map(draft => ({
                                            id: draft.id,
                                            info: {
                                                session_id: draft.name,
                                                display_name: draft.display_name || draft.name,
                                                branch: draft.branch,
                                                worktree_path: draft.worktree_path || '',
                                                base_branch: draft.parent_branch,
                                                merge_mode: 'rebase',
                                                status: 'draft' as any,
                                                session_state: 'draft',
                                                created_at: new Date(draft.created_at).toISOString(),
                                                last_modified: draft.updated_at ? new Date(draft.updated_at).toISOString() : new Date(draft.created_at).toISOString(),
                                                has_uncommitted_changes: false,
                                                ready_to_merge: false,
                                                diff_stats: undefined,
                                                is_current: false,
                                                session_type: 'worktree' as any,
                                            },
                                            terminals: [
                                                `session-${draft.name}-top`,
                                                `session-${draft.name}-bottom`
                                            ]
                                        }))
                                        const allSessions = [...regularSessions, ...enrichedDrafts]
                                        setSessions(allSessions.map(s => ({
                                            ...s,
                                            info: {
                                                ...s.info,
                                                last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                                            }
                                        })))
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
                                        const [regularSessions, draftSessions] = await Promise.all([
                                            invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                                            invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                                        ])
                                        const enrichedDrafts: EnrichedSession[] = draftSessions.map(draft => ({
                                            id: draft.id,
                                            info: {
                                                session_id: draft.name,
                                                display_name: draft.display_name || draft.name,
                                                branch: draft.branch,
                                                worktree_path: draft.worktree_path || '',
                                                base_branch: draft.parent_branch,
                                                merge_mode: 'rebase',
                                                status: 'draft' as any,
                                                session_state: 'draft',
                                                created_at: new Date(draft.created_at).toISOString(),
                                                last_modified: draft.updated_at ? new Date(draft.updated_at).toISOString() : new Date(draft.created_at).toISOString(),
                                                has_uncommitted_changes: false,
                                                ready_to_merge: false,
                                                diff_stats: undefined,
                                                is_current: false,
                                                session_type: 'worktree' as any,
                                            },
                                            terminals: [
                                                `session-${draft.name}-top`,
                                                `session-${draft.name}-bottom`
                                            ]
                                        }))
                                        const allSessions = [...regularSessions, ...enrichedDrafts]
                                        setSessions(allSessions.map(s => ({
                                            ...s,
                                            info: {
                                                ...s.info,
                                                last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                                            }
                                        })))
                                    } catch (err) {
                                        console.error('Failed to delete draft:', err)
                                    }
                                }}
                            />
                        )
                    })
                )}
            </div>
            <MarkReadyConfirmation
                open={markReadyModal.open}
                sessionName={markReadyModal.sessionName}
                hasUncommittedChanges={markReadyModal.hasUncommitted}
                onClose={() => setMarkReadyModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    // Reload both regular and draft sessions
                    const [regularSessions, draftSessions] = await Promise.all([
                        invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                        invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                    ])
                    const enrichedDrafts: EnrichedSession[] = draftSessions.map(draft => ({
                        id: draft.id,
                        info: {
                            session_id: draft.name,
                            display_name: draft.display_name || draft.name,
                            branch: draft.branch,
                            worktree_path: draft.worktree_path || '',
                            base_branch: draft.parent_branch,
                            merge_mode: 'rebase',
                            status: 'draft' as any,
                            session_state: 'draft',
                            created_at: new Date(draft.created_at).toISOString(),
                            last_modified: draft.updated_at ? new Date(draft.updated_at).toISOString() : new Date(draft.created_at).toISOString(),
                            has_uncommitted_changes: false,
                            ready_to_merge: false,
                            diff_stats: undefined,
                            is_current: false,
                            session_type: 'worktree' as any,
                        },
                        terminals: [
                            `session-${draft.name}-top`,
                            `session-${draft.name}-bottom`
                        ]
                    }))
                    const allSessions = [...regularSessions, ...enrichedDrafts]
                    setSessions(allSessions.map(s => ({
                        ...s,
                        info: {
                            ...s.info,
                            last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                        }
                    })))
                }}
            />
            <ConvertToDraftConfirmation
                open={convertToDraftModal.open}
                sessionName={convertToDraftModal.sessionName}
                sessionDisplayName={convertToDraftModal.sessionDisplayName}
                hasUncommittedChanges={convertToDraftModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', hasUncommitted: false })}
                onSuccess={async () => {
                    // Refresh sessions list
                    const [regularSessions, draftSessions] = await Promise.all([
                        invoke<EnrichedSession[]>('para_core_list_enriched_sessions'),
                        invoke<any[]>('para_core_list_sessions_by_state', { state: 'draft' })
                    ])
                    
                    // Convert draft sessions to enriched format
                    const enrichedDrafts = draftSessions.map(draft => ({
                        info: {
                            session_id: draft.name,
                            display_name: draft.display_name,
                            branch: '',
                            worktree_path: '',
                            base_branch: '',
                            merge_mode: '',
                            status: 'draft' as any,
                            created_at: draft.created_at,
                            last_modified: draft.updated_at,
                            has_uncommitted_changes: false,
                            ready_to_merge: false,
                            session_state: 'draft',
                            current_task: draft.draft_content?.split('\n')[0]?.replace(/^#\s*/, '') || 'Draft task',
                            todo_percentage: 0,
                            is_blocked: false,
                            diff_stats: undefined,
                            is_current: false,
                            session_type: 'worktree' as any,
                        },
                        terminals: [
                            `session-${draft.name}-top`,
                            `session-${draft.name}-bottom`
                        ]
                    }))
                    const allSessions = [...regularSessions, ...enrichedDrafts]
                    setSessions(allSessions.map(s => ({
                        ...s,
                        info: {
                            ...s.info,
                            last_modified_ts: s.info.last_modified ? Date.parse(s.info.last_modified) : undefined,
                        }
                    })))
                }}
            />
            <SwitchOrchestratorModal
                open={switchOrchestratorModal}
                onClose={() => setSwitchOrchestratorModal(false)}
                onSwitch={async (agentType) => {
                    // Get current orchestrator terminal IDs from the selection context
                    const orchestratorTerminals = [terminals.top, `${terminals.bottomBase}-0`]
                    // Right panel is not a terminal, only close the two actual terminals
                    const allTerminals = [...orchestratorTerminals]
                    
                    // First close existing orchestrator terminals
                    for (const terminalId of allTerminals) {
                        try {
                            const exists = await invoke<boolean>('terminal_exists', { id: terminalId })
                            if (exists) {
                                await invoke('close_terminal', { id: terminalId })
                            }
                        } catch (e) {
                            console.error(`Failed to close terminal ${terminalId}:`, e)
                        }
                    }
                    
                    // Clear terminal tracking so they can be recreated
                    await clearTerminalTracking(allTerminals)
                    
                    // Also clear the Terminal component's global started tracking
                    clearTerminalStartedTracking(allTerminals)
                    
                    // Update the agent type preference
                    await invoke('para_core_set_agent_type', { agentType })
                    
                    // Close the modal
                    setSwitchOrchestratorModal(false)
                    
                    // Dispatch event to reset terminals UI
                    window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
                    
                    // Small delay to ensure terminals are closed before recreating
                    setTimeout(async () => {
                        // Force recreate terminals with new model
                        await setSelection({ kind: 'orchestrator' }, true, true) // User action - intentional
                    }, 200)
                }}
            />
        </div>
    )
}