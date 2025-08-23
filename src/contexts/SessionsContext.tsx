import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
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
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'draft'
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
    const [loading, setLoading] = useState(false)
    const [lastProjectPath, setLastProjectPath] = useState<string | null>(null)

    const reloadSessions = useCallback(async () => {
        if (!projectPath) {
            setSessions([])
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const enrichedSessions = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
            setSessions(enrichedSessions || [])
        } catch (error) {
            console.error('Failed to load sessions:', error)
            setSessions([])
        } finally {
            setLoading(false)
        }
    }, [projectPath])

    const updateSessionStatus = useCallback(async (sessionId: string, newStatus: string) => {
        try {
            // First, we need to get the current session state
            const currentSessions = await invoke<EnrichedSession[]>('para_core_list_enriched_sessions')
            const session = currentSessions?.find(s => s.info.session_id === sessionId)
            
            if (!session) {
                console.error(`Session ${sessionId} not found`)
                return
            }

            if (newStatus === 'draft') {
                await invoke('para_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                if (session.info.status === 'draft') {
                    await invoke('para_core_start_draft_session', { name: sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke('para_core_unmark_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                await invoke('para_core_mark_ready', { name: sessionId })
            }

            await reloadSessions()
        } catch (error) {
            console.error('Failed to update session status:', error)
        }
    }, [reloadSessions])

    const createDraft = useCallback(async (name: string, content: string) => {
        try {
            await invoke('para_core_create_draft_session', { name, content })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to create draft:', error)
            throw error
        }
    }, [reloadSessions])

    useEffect(() => {
        // Only reload sessions when projectPath actually changes
        if (projectPath !== lastProjectPath) {
            setLastProjectPath(projectPath)
            if (projectPath) {
                reloadSessions()
            } else {
                setSessions([])
                setLoading(false)
            }
        }

        const unlisteners: UnlistenFn[] = []

        const setupListeners = async () => {
            const u1 = await listen<EnrichedSession[]>('schaltwerk:sessions-refreshed', (event) => {
                if (event.payload) {
                    setSessions(event.payload)
                }
            })
            unlisteners.push(u1)

            const u2 = await listen<{ session_name: string }>('schaltwerk:session-removed', (event) => {
                setSessions(prev => prev.filter(s => s.info.session_id !== event.payload.session_name))
            })
            unlisteners.push(u2)
        }

        setupListeners()

        return () => {
            unlisteners.forEach(unlisten => unlisten())
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