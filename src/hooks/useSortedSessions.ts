import { useState, useEffect, useCallback, useRef } from 'react'
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
        status: 'active' | 'dirty' | 'missing' | 'archived' | 'spec'
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
    const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const isInitialLoadRef = useRef(true)

    const loadSortedSessions = useCallback(async () => {
        if (!projectPath) {
            setSessions([])
            setLoading(false)
            return
        }

        try {
            // Only show loading state on initial load
            if (isInitialLoadRef.current) {
                setLoading(true)
            }
            setError(null)
            
            const sortedSessions = await invoke<EnrichedSession[]>('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode,
                filterMode
            })
            
            setSessions(sortedSessions || [])
            isInitialLoadRef.current = false
        } catch (err) {
            console.error('Failed to load sorted sessions:', err)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [projectPath, sortMode, filterMode])
    
    // Debounced version to reduce flashing on rapid updates
    const loadSortedSessionsDebounced = useCallback(() => {
        // Clear any pending timeout
        if (loadTimeoutRef.current) {
            clearTimeout(loadTimeoutRef.current)
        }
        
        // Set a new timeout to load sessions after a short delay
        loadTimeoutRef.current = setTimeout(() => {
            loadSortedSessions()
        }, 200) // Increased to 200ms to reduce flashing further
    }, [loadSortedSessions])

    // Load sessions when project or sort/filter options change
    useEffect(() => {
        // Reset initial load flag when filter/sort changes
        isInitialLoadRef.current = true
        loadSortedSessions()
    }, [loadSortedSessions])

    // Listen for session changes
    useEffect(() => {
        if (!projectPath) return

        const unlistenPromises = Promise.all([
            listen('schaltwerk:sessions-refreshed', () => {
                loadSortedSessionsDebounced()
            }),
            listen('schaltwerk:session-added', () => {
                loadSortedSessionsDebounced()
            }),
            listen('schaltwerk:session-removed', () => {
                loadSortedSessionsDebounced()
            })
        ])

        return () => {
            // Clear any pending timeout
            if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current)
            }
            
            unlistenPromises.then(unlisteners => {
                unlisteners.forEach(unlisten => unlisten())
            })
        }
    }, [projectPath, loadSortedSessionsDebounced])

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