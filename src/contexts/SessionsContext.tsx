import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useProject } from './ProjectContext'

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
    loading: boolean
    reloadSessions: () => Promise<void>
    updateSessionStatus: (sessionId: string, newStatus: string) => Promise<void>
    createDraft: (name: string, content: string) => Promise<void>
}

const SessionsContext = createContext<SessionsContextValue | undefined>(undefined)

export function SessionsProvider({ children }: { children: ReactNode }) {
    const { projectPath } = useProject()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    const prevStatesRef = useRef<Map<string, string>>(new Map())
    const [lastProjectPath, setLastProjectPath] = useState<string | null>(null)
    const hasInitialLoadCompleted = useRef(false)

    // Normalize backend info into UI categories
    const mapSessionUiState = (info: SessionInfo): 'plan' | 'running' | 'reviewed' => {
        if (info.session_state === 'plan' || info.status === 'plan') return 'plan'
        if (info.ready_to_merge) return 'reviewed'
        return 'running'
    }

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
            setSessions([])
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
                setSessions(enriched)
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
                setSessions(all)
                const nextStates = new Map<string, string>()
                for (const s of all) nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                prevStatesRef.current = nextStates
            }
        } catch (error) {
            console.error('Failed to load sessions:', error)
            setSessions([])
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

    useEffect(() => {
        // Only reload sessions when projectPath actually changes
        if (projectPath !== lastProjectPath) {
            setLastProjectPath(projectPath)
            hasInitialLoadCompleted.current = false
            if (projectPath) {
                reloadSessions()
            } else {
                setSessions([])
                setLoading(false)
            }
        }

        let unlisteners: UnlistenFn[] = []

        const setupListeners = async () => {
            // Full refresh (authoritative list) + plans merge
            const uRefresh = await listen<EnrichedSession[]>('schaltwerk:sessions-refreshed', async (event) => {
                try {
                    if (event.payload && event.payload.length > 0) {
                        // Treat payload as authoritative for now to avoid test flakiness
                        setSessions(event.payload)
                        const next = new Map<string, string>()
                        for (const s of event.payload) next.set(s.info.session_id, mapSessionUiState(s.info))
                        prevStatesRef.current = next
                    } else {
                        await reloadSessions()
                    }
                } catch (e) {
                    console.error('Failed to reload sessions:', e)
                }
            })
            unlisteners.push(uRefresh)

            // Activity updates
            const uActivity = await listen<{ 
                session_name: string; 
                last_activity_ts: number;
                current_task?: string;
                todo_percentage?: number;
                is_blocked?: boolean;
            }>('schaltwerk:session-activity', (event) => {
                const { session_name, last_activity_ts, current_task, todo_percentage, is_blocked } = event.payload
                setSessions(prev => prev.map(s => {
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
            })
            unlisteners.push(uActivity)

            // Git stats updates
            const uGit = await listen<{ session_name: string; files_changed: number; lines_added: number; lines_removed: number; has_uncommitted: boolean }>('schaltwerk:session-git-stats', (event) => {
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
            unlisteners.push(uGit)

            // Session added
            const uAdded = await listen<{ session_name: string; branch: string; worktree_path: string; parent_branch: string }>('schaltwerk:session-added', (event) => {
                const { session_name, branch, worktree_path, parent_branch } = event.payload
                setSessions(prev => {
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
            })
            unlisteners.push(uAdded)

            // Session cancelling (marks as cancelling but doesn't remove)
            const uCancelling = await listen<{ session_name: string }>('schaltwerk:session-cancelling', (event) => {
                setSessions(prev => prev.map(s => {
                    if (s.info.session_id !== event.payload.session_name) return s
                    return {
                        ...s,
                        info: {
                            ...s.info,
                            status: 'cancelling' as any
                        }
                    }
                }))
            })
            unlisteners.push(uCancelling)

            // Session removed (actual removal after cancellation completes)
            const uRemoved = await listen<{ session_name: string }>('schaltwerk:session-removed', (event) => {
                setSessions(prev => prev.filter(s => s.info.session_id !== event.payload.session_name))
            })
            unlisteners.push(uRemoved)
        }

        setupListeners()

        return () => {
            unlisteners.forEach(u => {
                try { (u as any)() } catch {}
            })
        }
    }, [projectPath, reloadSessions, lastProjectPath])

    return (
        <SessionsContext.Provider value={{
            sessions,
            loading,
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
