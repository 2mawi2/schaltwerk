import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useProject } from '../contexts/ProjectContext'
import { SortMode, FilterMode } from '../types/sessionFilters'

interface EnrichedSession {
    info: {
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
        diff_stats?: {
            files_changed: number
            additions: number
            deletions: number
            insertions: number
        }
        ready_to_merge?: boolean
    }
    status?: any
    terminals: string[]
}

interface UseSortedSessionsOptions {
    sortMode: SortMode
    filterMode: FilterMode
}

export function useSortedSessions({ sortMode, filterMode }: UseSortedSessionsOptions) {
    const { projectPath } = useProject()
    const [sessions, setSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const loadSortedSessions = useCallback(async () => {
        if (!projectPath) {
            setSessions([])
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            setError(null)
            
            const sortedSessions = await invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode,
                filterMode
            })
            
            setSessions(sortedSessions || [])
        } catch (err) {
            console.error('Failed to load sorted sessions:', err)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [projectPath, sortMode, filterMode])

    // Load sessions when project or sort/filter options change
    useEffect(() => {
        loadSortedSessions()
    }, [loadSortedSessions])

    // Listen for session changes
    useEffect(() => {
        if (!projectPath) return

        const unlistenPromises = Promise.all([
            listen('schaltwerk:sessions-refreshed', () => {
                loadSortedSessions()
            }),
            listen('schaltwerk:session-added', () => {
                loadSortedSessions()
            }),
            listen('schaltwerk:session-removed', () => {
                loadSortedSessions()
            })
        ])

        return () => {
            unlistenPromises.then(unlisteners => {
                unlisteners.forEach(unlisten => unlisten())
            })
        }
    }, [projectPath, loadSortedSessions])

    const reloadSessions = useCallback(() => {
        loadSortedSessions()
    }, [loadSortedSessions])

    return {
        sessions,
        loading,
        error,
        reloadSessions
    }
}