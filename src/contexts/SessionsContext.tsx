import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { useProject } from './ProjectContext'
import { useCleanupRegistry } from '../hooks/useCleanupRegistry'
import { SortMode, FilterMode, getDefaultSortMode, getDefaultFilterMode, isValidSortMode, isValidFilterMode } from '../types/sessionFilters'
import { mapSessionUiState, searchSessions as searchSessionsUtil } from '../utils/sessionFilters'
import { EnrichedSession, SessionInfo, SessionState } from '../types/session'
import { logger } from '../utils/logger'

interface SessionsContextValue {
    sessions: EnrichedSession[]
    allSessions: EnrichedSession[]
    filteredSessions: EnrichedSession[]
    sortedSessions: EnrichedSession[]
    loading: boolean
    sortMode: SortMode
    filterMode: FilterMode
    searchQuery: string
    isSearchVisible: boolean
    setSortMode: (mode: SortMode) => void
    setFilterMode: (mode: FilterMode) => void
    setSearchQuery: (query: string) => void
    setIsSearchVisible: (visible: boolean) => void
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
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false)
    const prevStatesRef = useRef<Map<string, string>>(new Map())
    const [lastProjectPath, setLastProjectPath] = useState<string | null>(null)
    const hasInitialLoadCompleted = useRef(false)
    const currentSelectionRef = useRef<string | null>(null)
    const [settingsLoaded, setSettingsLoaded] = useState(false)

    // Note: mapSessionUiState function moved to utils/sessionFilters.ts

    // Sort sessions while preserving object references for unchanged items
    const sortSessionsStable = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        if (sessions.length === 0) return sessions

        // Create a stable reference map to preserve object identity where possible
        const sessionMap = new Map(sessions.map(s => [s.info.session_id, s]))

        // Separate reviewed and unreviewed sessions (matching backend logic)
        const reviewed = sessions.filter(s => s.info.ready_to_merge)
        const unreviewed = sessions.filter(s => !s.info.ready_to_merge)

        // Sort unreviewed sessions by the current sort mode
        const sortedUnreviewed = [...unreviewed].sort((a, b) => {
            switch (sortMode) {
                case SortMode.Name:
                    return a.info.session_id.localeCompare(b.info.session_id)
                case SortMode.Created: {
                    const aCreated = new Date(a.info.created_at || 0).getTime()
                    const bCreated = new Date(b.info.created_at || 0).getTime()
                    return bCreated - aCreated // Newest first
                }
                case SortMode.LastEdited: {
                    const aModified = new Date(a.info.last_modified || 0).getTime()
                    const bModified = new Date(b.info.last_modified || 0).getTime()
                    return bModified - aModified // Most recently edited first
                }
                default:
                    return 0
            }
        })

        // Sort reviewed sessions alphabetically (matching backend logic)
        const sortedReviewed = [...reviewed].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))

        // Combine: unreviewed first, then reviewed
        const sorted = [...sortedUnreviewed, ...sortedReviewed]

        // Use original object references where possible to prevent unnecessary re-renders
        return sorted.map(s => sessionMap.get(s.info.session_id) || s)
    }, [sortMode])

    // Note: searchSessions function moved to utils/sessionFilters.ts
    const searchSessions = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        return searchSessionsUtil(sessions, searchQuery)
    }, [searchQuery])

    // Filter sessions based on the current filter mode
    const filterSessions = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        switch (filterMode) {
            case FilterMode.All:
                return sessions
            case FilterMode.Spec:
                return sessions.filter(s => mapSessionUiState(s.info) === 'spec')
            case FilterMode.Running:
                return sessions.filter(s => mapSessionUiState(s.info) === 'running')
            case FilterMode.Reviewed:
                return sessions.filter(s => mapSessionUiState(s.info) === 'reviewed')
            default:
                return sessions
        }
    }, [filterMode])

    // Apply search first, then filter mode, then sort
    const searchedSessions = searchSessions(allSessions)
    const filteredSessions = filterSessions(searchedSessions)
    const sortedSessions = sortSessionsStable(filteredSessions)
    
    // Sessions is the final result (searched, filtered, and sorted)
    const sessions = sortedSessions

    // Function to update the current selection (used by SelectionContext)
    const setCurrentSelection = useCallback((sessionId: string | null) => {
        currentSelectionRef.current = sessionId
    }, [])

    const mergeSessionsPreferDraft = (base: EnrichedSession[], specs: EnrichedSession[]): EnrichedSession[] => {
        const byId = new Map<string, EnrichedSession>()
        for (const s of base) byId.set(s.info.session_id, s)
        for (const d of specs) {
            const existing = byId.get(d.info.session_id)
            if (!existing || mapSessionUiState(existing.info) !== 'spec') byId.set(d.info.session_id, d)
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
            const hasSpecSessions = (sessions: EnrichedSession[]) => {
                return sessions.some(s => mapSessionUiState(s.info) === 'spec')
            }

            // If enriched already contains specs, use it as-is
            if (hasSpecSessions(enriched)) {
                setAllSessions(enriched)
                const nextStates = new Map<string, string>()
                for (const s of enriched) {
                    nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                }
                prevStatesRef.current = nextStates
            } else {
                // Try to fetch explicit specs; if shape is unexpected, ignore
                let all = enriched
                try {
                    const draftSessions = await invoke<any[]>('schaltwerk_core_list_sessions_by_state', { state: SessionState.Spec })
                    
                    const hasValidDraftSessions = (drafts: any[]): boolean => {
                        return Array.isArray(drafts) && drafts.some(d => d && (d.name || d.id))
                    }

                    if (hasValidDraftSessions(draftSessions)) {
                        const enrichDraftSessions = (drafts: any[]): EnrichedSession[] => {
                            return drafts.map(spec => ({
                            id: spec.id,
                            info: {
                                session_id: spec.name,
                                display_name: spec.display_name || spec.name,
                                branch: spec.branch,
                                worktree_path: spec.worktree_path || '',
                                base_branch: spec.parent_branch,
                                status: 'spec' as any,
                                session_state: SessionState.Spec,
                                created_at: spec.created_at ? new Date(spec.created_at).toISOString() : undefined,
                                last_modified: spec.updated_at ? new Date(spec.updated_at).toISOString() : undefined,
                                has_uncommitted_changes: false,
                                ready_to_merge: false,
                                diff_stats: undefined,
                                is_current: false,
                                session_type: 'worktree' as any,
                            },
                            terminals: []
                        }))
                        }
                        
                        const enrichedDrafts = enrichDraftSessions(draftSessions)
                        all = mergeSessionsPreferDraft(enriched, enrichedDrafts)
                    }
                } catch (error) {
                    // Failed to fetch draft sessions, continue with enriched only
                    logger.warn('Failed to fetch draft sessions, continuing with enriched sessions only:', error)
                }
                setAllSessions(all)
                const nextStates = new Map<string, string>()
                for (const s of all) {
                    nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                }
                prevStatesRef.current = nextStates
            }
        } catch (error) {
            logger.error('Failed to load sessions:', error)
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
                logger.error(`Session ${sessionId} not found`)
                return
            }

            if (newStatus === 'spec') {
                await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                if (session.info.status === 'spec') {
                    await invoke('schaltwerk_core_start_spec_session', { name: sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke('schaltwerk_core_unmark_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                await invoke('schaltwerk_core_mark_ready', { name: sessionId })
            }

            await reloadSessions()
        } catch (error) {
            logger.error('Failed to update session status:', error)
        }
    }, [reloadSessions])

    const createDraft = useCallback(async (name: string, content: string) => {
        try {
            await invoke('schaltwerk_core_create_spec_session', { name, specContent: content })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to create spec:', error)
            throw error
        }
    }, [reloadSessions])

    const addListener = useCallback((unlistenPromise: Promise<UnlistenFn>) => {
        if (!unlistenPromise || typeof unlistenPromise.then !== 'function') {
            logger.warn('[SessionsContext] Invalid listener promise received:', unlistenPromise)
            return
        }
        unlistenPromise.then(cleanup => {
            addCleanup(cleanup)
        }).catch(error => {
            logger.error('[SessionsContext] Failed to add listener:', error)
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
                logger.warn('Failed to load project sessions settings:', error)
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
                logger.warn('Failed to save sessions settings:', error)
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
            // Full refresh (authoritative list) + specs merge
            addListener(listenEvent(SchaltEvent.SessionsRefreshed, async (event) => {
                try {
                    if (event && event.length > 0) {
                        // Do a smart merge instead of replacing the entire array to reduce flashing
                        // This preserves session order and references to avoid selection jumping
                        setAllSessions(prev => {
                            // Create a map of new sessions for quick lookup
                            const newSessionsMap = new Map<string, EnrichedSession>()
                            for (const session of event) {
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
                            for (const newSession of event) {
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
                        for (const s of event) next.set(s.info.session_id, mapSessionUiState(s.info))
                        prevStatesRef.current = next
                    } else {
                        await reloadSessions()
                    }
                } catch (e) {
                    logger.error('[SessionsContext] Failed to reload sessions:', e)
                }
            }))

            // Activity updates
            addListener(listenEvent(SchaltEvent.SessionActivity, (event) => {
                const { session_name, last_activity_ts, current_task, todo_percentage, is_blocked } = event
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
            addListener(listenEvent(SchaltEvent.SessionGitStats, (event) => {
                const { session_name, files_changed, lines_added, lines_removed, has_uncommitted } = event
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
            addListener(listenEvent(SchaltEvent.SessionAdded, (event) => {
                const { session_name, branch, worktree_path, parent_branch } = event
                setAllSessions(prev => {
                    if (prev.some(s => s.info.session_id === session_name)) return prev
                    const info: SessionInfo = {
                        session_id: session_name,
                        branch,
                        worktree_path,
                        base_branch: parent_branch,
                        status: 'active',
                        last_modified: undefined,
                        has_uncommitted_changes: false,
                        is_current: false,
                        session_type: 'worktree',
                        container_status: undefined,
                        session_state: 'running',
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
            addListener(listenEvent(SchaltEvent.SessionCancelling, (event) => {
                setAllSessions(prev => prev.map(s => {
                    if (s.info.session_id !== event.session_name) return s
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
            addListener(listenEvent(SchaltEvent.SessionRemoved, (event) => {
                setAllSessions(prev => prev.filter(s => s.info.session_id !== event.session_name))
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
            searchQuery,
            isSearchVisible,
            setSortMode,
            setFilterMode,
            setSearchQuery,
            setIsSearchVisible,
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
