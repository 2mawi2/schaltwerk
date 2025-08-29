import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useProject } from './ProjectContext'
import { useCleanupRegistry } from '../hooks/useCleanupRegistry'
import { SortMode, FilterMode, getDefaultSortMode, getDefaultFilterMode, isValidSortMode, isValidFilterMode } from '../types/sessionFilters'

interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

interface SessionInfo {
    session_id: string
    display_name?: string
    branch: string
    worktree_path: string
    base_branch: string
    merge_mode: string
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'plan'
    created_at?: string
    last_modified?: string
    has_uncommitted_changes?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    session_state?: string
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
    ready_to_merge?: boolean
}

interface EnrichedSession {
    info: SessionInfo
    status?: any
    terminals: string[]
}

interface SessionsContextValue {
    sessions: EnrichedSession[]
    allSessions: EnrichedSession[]
    filteredSessions: EnrichedSession[]
    sortedSessions: EnrichedSession[]
    loading: boolean
    sortMode: SortMode
    filterMode: FilterMode
    setSortMode: (mode: SortMode) => void
    setFilterMode: (mode: FilterMode) => void
    setCurrentSelection: (sessionId: string | null) => void
    reloadSessions: () => Promise<void>
    updateSessionStatus: (sessionId: string, newStatus: string) => Promise<void>
    createDraft: (name: string, content: string) => Promise<void>
}

const SessionsContext = createContext<SessionsContextValue | undefined>(undefined)

export function SessionsProvider({ children }: { children: ReactNode }) {
    const { projectPath } = useProject()
    const { addCleanup } = useCleanupRegistry()
    const [allSessions, setAllSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    const [sortMode, setSortMode] = useState<SortMode>(getDefaultSortMode())
    const [filterMode, setFilterMode] = useState<FilterMode>(getDefaultFilterMode())
    const prevStatesRef = useRef<Map<string, string>>(new Map())
    const [lastProjectPath, setLastProjectPath] = useState<string | null>(null)
    const hasInitialLoadCompleted = useRef(false)
    const currentSelectionRef = useRef<string | null>(null)
    const [settingsLoaded, setSettingsLoaded] = useState(false)

    // Normalize backend info into UI categories
    const mapSessionUiState = (info: SessionInfo): 'plan' | 'running' | 'reviewed' => {
        if (info.session_state === 'plan' || info.status === 'plan') return 'plan'
        if (info.ready_to_merge) return 'reviewed'
        return 'running'
    }

    // Sort sessions while preserving the currently selected session's position in the list
    const sortSessionsStable = useCallback((sessions: EnrichedSession[], selectedSessionId: string | null): EnrichedSession[] => {
        if (sessions.length === 0) return sessions

        // Find the selected session
        const selectedIndex = selectedSessionId ? sessions.findIndex(s => s.info.session_id === selectedSessionId) : -1

        // Separate reviewed and unreviewed sessions (matching backend logic)
        const reviewed = sessions.filter(s => s.info.ready_to_merge)
        const unreviewed = sessions.filter(s => !s.info.ready_to_merge)

        // Sort unreviewed sessions by the current sort mode
        const sortedUnreviewed = [...unreviewed].sort((a, b) => {
            switch (sortMode) {
                case SortMode.Name:
                    return a.info.session_id.localeCompare(b.info.session_id)
                case SortMode.Created:
                    const aCreated = new Date(a.info.created_at || 0).getTime()
                    const bCreated = new Date(b.info.created_at || 0).getTime()
                    return bCreated - aCreated // Newest first
                case SortMode.LastEdited:
                    const aModified = new Date(a.info.last_modified || 0).getTime()
                    const bModified = new Date(b.info.last_modified || 0).getTime()
                    return bModified - aModified // Most recently edited first
                default:
                    return 0
            }
        })

        // Sort reviewed sessions alphabetically (matching backend logic)
        const sortedReviewed = [...reviewed].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))

        // Combine: unreviewed first, then reviewed
        const sorted = [...sortedUnreviewed, ...sortedReviewed]

        // If there was a selected session, try to preserve its relative position to reduce visual jumping
        if (selectedIndex >= 0 && selectedSessionId) {
            const newSelectedIndex = sorted.findIndex(s => s.info.session_id === selectedSessionId)

            if (newSelectedIndex >= 0 && newSelectedIndex !== selectedIndex) {
                // The selected session moved in the sorted list
                // This is expected behavior for sorting, so we don't need to do anything special
                // The selection should be preserved by the SelectionContext
            }
        }

        return sorted
    }, [sortMode])

    // Filter sessions based on the current filter mode
    const filterSessions = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        switch (filterMode) {
            case FilterMode.All:
                return sessions
            case FilterMode.Plan:
                return sessions.filter(s => mapSessionUiState(s.info) === 'plan')
            case FilterMode.Running:
                return sessions.filter(s => mapSessionUiState(s.info) === 'running')
            case FilterMode.Reviewed:
                return sessions.filter(s => mapSessionUiState(s.info) === 'reviewed')
            default:
                return sessions
        }
    }, [filterMode])

    // Get filtered sessions
    const filteredSessions = filterSessions(allSessions)
    
    // Get sorted sessions (filtered first, then sorted)
    const sortedSessions = sortSessionsStable(filteredSessions, currentSelectionRef.current)
    
    // Sessions is the final result (sorted and filtered)
    const sessions = sortedSessions

    // Function to update the current selection (used by SelectionContext)
    const setCurrentSelection = useCallback((sessionId: string | null) => {
        currentSelectionRef.current = sessionId
    }, [])

    const mergeSessionsPreferDraft = (base: EnrichedSession[], plans: EnrichedSession[]): EnrichedSession[] => {
        const byId = new Map<string, EnrichedSession>()
        for (const s of base) byId.set(s.info.session_id, s)
        for (const d of plans) {
            const existing = byId.get(d.info.session_id)
            if (!existing || mapSessionUiState(existing.info) !== 'plan') byId.set(d.info.session_id, d)
        }
        return Array.from(byId.values())
    }

    const reloadSessions = useCallback(async () => {
        if (!projectPath) {
            setAllSessions([])
            setLoading(false)
            hasInitialLoadCompleted.current = false
            return
        }

        try {
            // Only show loading state on initial load
            if (!hasInitialLoadCompleted.current) {
                setLoading(true)
            }
            const enrichedSessions = await invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions')
            const enriched = enrichedSessions || []
            // If enriched already contains plans, use it as-is
            if (enriched.some(s => mapSessionUiState(s.info) === 'plan')) {
                setAllSessions(enriched)
                const nextStates = new Map<string, string>()
                for (const s of enriched) nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                prevStatesRef.current = nextStates
            } else {
                // Try to fetch explicit plans; if shape is unexpected, ignore
                let all = enriched
                try {
                    const draftSessions = await invoke<any[]>('schaltwerk_core_list_sessions_by_state', { state: 'plan' })
                    if (Array.isArray(draftSessions) && draftSessions.some(d => d && (d.name || d.id))) {
                        const enrichedDrafts: EnrichedSession[] = draftSessions.map(plan => ({
                            id: plan.id,
                            info: {
                                session_id: plan.name,
                                display_name: plan.display_name || plan.name,
                                branch: plan.branch,
                                worktree_path: plan.worktree_path || '',
                                base_branch: plan.parent_branch,
                                merge_mode: 'rebase',
                                status: 'plan' as any,
                                session_state: 'plan',
                                created_at: plan.created_at ? new Date(plan.created_at).toISOString() : undefined,
                                last_modified: plan.updated_at ? new Date(plan.updated_at).toISOString() : undefined,
                                has_uncommitted_changes: false,
                                ready_to_merge: false,
                                diff_stats: undefined,
                                is_current: false,
                                session_type: 'worktree' as any,
                            },
                            terminals: [`session-${plan.name}-top`, `session-${plan.name}-bottom`]
                        }))
                        all = mergeSessionsPreferDraft(enriched, enrichedDrafts)
                    }
                } catch {}
                setAllSessions(all)
                const nextStates = new Map<string, string>()
                for (const s of all) nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                prevStatesRef.current = nextStates
            }
        } catch (error) {
            console.error('Failed to load sessions:', error)
            setAllSessions([])
        } finally {
            setLoading(false)
            hasInitialLoadCompleted.current = true
        }
    }, [projectPath])

    const updateSessionStatus = useCallback(async (sessionId: string, newStatus: string) => {
        try {
            // First, we need to get the current session state
            const currentSessions = await invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions')
            const session = currentSessions?.find(s => s.info.session_id === sessionId)
            
            if (!session) {
                console.error(`Session ${sessionId} not found`)
                return
            }

            if (newStatus === 'plan') {
                await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                if (session.info.status === 'plan') {
                    await invoke('schaltwerk_core_start_draft_session', { name: sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke('schaltwerk_core_unmark_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                await invoke('schaltwerk_core_mark_ready', { name: sessionId })
            }

            await reloadSessions()
        } catch (error) {
            console.error('Failed to update session status:', error)
        }
    }, [reloadSessions])

    const createDraft = useCallback(async (name: string, content: string) => {
        try {
            await invoke('schaltwerk_core_create_draft_session', { name, planContent: content })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to create plan:', error)
            throw error
        }
    }, [reloadSessions])

    const addListener = useCallback((unlistenPromise: Promise<UnlistenFn>) => {
        if (!unlistenPromise || typeof unlistenPromise.then !== 'function') {
            console.warn('[SessionsContext] Invalid listener promise received:', unlistenPromise)
            return
        }
        unlistenPromise.then(cleanup => {
            addCleanup(cleanup)
        }).catch(error => {
            console.error('[SessionsContext] Failed to add listener:', error)
        })
    }, [addCleanup])

    // Load sort/filter settings when project changes
    useEffect(() => {
        if (!projectPath) {
            setSettingsLoaded(false)
            return
        }
        
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
                }
                setSettingsLoaded(true)
            } catch (error) {
                console.warn('Failed to load project sessions settings:', error)
                setSettingsLoaded(true)
            }
        }
        
        loadProjectSettings()
    }, [projectPath])

    // Save settings when they change
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
    }, [sortMode, filterMode, settingsLoaded, projectPath])

    useEffect(() => {
        // Only reload sessions when projectPath actually changes
        if (projectPath !== lastProjectPath) {
            setLastProjectPath(projectPath)
            hasInitialLoadCompleted.current = false
            if (projectPath) {
                reloadSessions()
            } else {
                setAllSessions([])
                setLoading(false)
            }
        }

        // Previous listeners will be cleaned up automatically by useCleanupRegistry

        const setupListeners = async () => {
            // Full refresh (authoritative list) + plans merge
            addListener(listen<EnrichedSession[]>('schaltwerk:sessions-refreshed', async (event) => {
                try {
                    if (event.payload && event.payload.length > 0) {
                        // Do a smart merge instead of replacing the entire array to reduce flashing
                        // This preserves session order and references to avoid selection jumping
                        setAllSessions(prev => {
                            // Create a map of new sessions for quick lookup
                            const newSessionsMap = new Map<string, EnrichedSession>()
                            for (const session of event.payload) {
                                newSessionsMap.set(session.info.session_id, session)
                            }
                            
                            // Keep existing sessions if they haven't changed, preserving order
                            const updated: EnrichedSession[] = []
                            const seenIds = new Set<string>()
                            
                            // First, update existing sessions in their current positions
                            for (const existing of prev) {
                                const newSession = newSessionsMap.get(existing.info.session_id)
                                if (newSession) {
                                    // Check if the session has actually changed
                                    if (JSON.stringify(existing.info) !== JSON.stringify(newSession.info)) {
                                        updated.push(newSession)
                                    } else {
                                        updated.push(existing) // Keep existing reference to avoid re-render
                                    }
                                    seenIds.add(existing.info.session_id)
                                }
                                // Note: If the session doesn't exist in newSession, it's removed (don't add to updated)
                            }
                            
                            // Add new sessions at the end
                            for (const newSession of event.payload) {
                                if (!seenIds.has(newSession.info.session_id)) {
                                    updated.push(newSession)
                                }
                            }
                            
                            // Only update if something actually changed
                            if (updated.length === prev.length && 
                                updated.every((s, i) => s === prev[i])) {
                                return prev // No change, keep same reference
                            }
                            
                            return updated
                        })
                        
                        const next = new Map<string, string>()
                        for (const s of event.payload) next.set(s.info.session_id, mapSessionUiState(s.info))
                        prevStatesRef.current = next
                    } else {
                        await reloadSessions()
                    }
                } catch (e) {
                    console.error('[SessionsContext] Failed to reload sessions:', e)
                }
            }))

            // Activity updates
            addListener(listen<{ 
                session_name: string; 
                last_activity_ts: number;
                current_task?: string;
                todo_percentage?: number;
                is_blocked?: boolean;
            }>('schaltwerk:session-activity', (event) => {
                const { session_name, last_activity_ts, current_task, todo_percentage, is_blocked } = event.payload
                setAllSessions(prev => prev.map(s => {
                    if (s.info.session_id !== session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            last_modified: new Date(last_activity_ts * 1000).toISOString(),
                            last_modified_ts: last_activity_ts * 1000,
                            current_task: current_task || s.info.current_task,
                            todo_percentage: todo_percentage || s.info.todo_percentage,
                            is_blocked: is_blocked || s.info.is_blocked,
                        }
                    }
                }))
            }))

            // Git stats updates
            addListener(listen<{ session_name: string; files_changed: number; lines_added: number; lines_removed: number; has_uncommitted: boolean }>('schaltwerk:session-git-stats', (event) => {
                const { session_name, files_changed, lines_added, lines_removed, has_uncommitted } = event.payload
                setAllSessions(prev => prev.map(s => {
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
            }))

            // Session added
            addListener(listen<{ session_name: string; branch: string; worktree_path: string; parent_branch: string }>('schaltwerk:session-added', (event) => {
                const { session_name, branch, worktree_path, parent_branch } = event.payload
                setAllSessions(prev => {
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
                    const terminals = [`session-${session_name}-top`, `session-${session_name}-bottom`]
                    const enriched: EnrichedSession = { info, status: undefined, terminals }
                    return [enriched, ...prev]
                })
            }))

            // Session cancelling (marks as cancelling but doesn't remove)
            addListener(listen<{ session_name: string }>('schaltwerk:session-cancelling', (event) => {
                setAllSessions(prev => prev.map(s => {
                    if (s.info.session_id !== event.payload.session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            status: 'cancelling' as any
                        }
                    }
                }))
            }))

            // Session removed (actual removal after cancellation completes)
            addListener(listen<{ session_name: string }>('schaltwerk:session-removed', (event) => {
                setAllSessions(prev => prev.filter(s => s.info.session_id !== event.payload.session_name))
            }))
        }

        setupListeners()
    }, [projectPath, reloadSessions, lastProjectPath, addListener])

    return (
        <SessionsContext.Provider value={{
            sessions,
            allSessions,
            filteredSessions,
            sortedSessions,
            loading,
            sortMode,
            filterMode,
            setSortMode,
            setFilterMode,
            setCurrentSelection,
            reloadSessions,
            updateSessionStatus,
            createDraft
        }}>
            {children}
        </SessionsContext.Provider>
    )
}

export function useSessions() {
    const context = useContext(SessionsContext)
    if (!context) {
        throw new Error('useSessions must be used within SessionsProvider')
    }
    return context
}
