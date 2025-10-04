import { SessionInfo } from '../types/session'

type DiffStats = { files_changed: number; additions: number; deletions: number; insertions: number }

const SESSION_INFO_KEYS: ReadonlyArray<keyof SessionInfo> = [
    'session_id',
    'display_name',
    'branch',
    'worktree_path',
    'base_branch',
    'parent_branch',
    'status',
    'created_at',
    'last_modified',
    'last_modified_ts',
    'has_uncommitted_changes',
    'has_conflicts',
    'is_current',
    'session_type',
    'container_status',
    'ready_to_merge',
    'session_state',
    'current_task',
    'todo_percentage',
    'is_blocked',
    'version_group_id',
    'version_number',
    'original_agent_type',
    'spec_content',
    'diff_stats',
    'top_uncommitted_paths',
    'merge_conflicting_paths',
    'merge_has_conflicts',
    'merge_is_up_to_date',
] as const

const DIFF_STATS_KEYS: ReadonlyArray<keyof DiffStats> = [
    'files_changed',
    'additions',
    'deletions',
    'insertions',
] as const

export function areSessionInfosEqual(a: SessionInfo, b: SessionInfo): boolean {
    if (a === b) return true

    for (const key of SESSION_INFO_KEYS) {
        const aVal = a[key]
        const bVal = b[key]

        if (key === 'diff_stats') {
            if (!areDiffStatsEqual(aVal as DiffStats | undefined, bVal as DiffStats | undefined)) {
                return false
            }
        } else if (key === 'top_uncommitted_paths' || key === 'merge_conflicting_paths') {
            if (!areArraysEqual(aVal as string[] | undefined, bVal as string[] | undefined)) {
                return false
            }
        } else {
            if (aVal !== bVal) {
                return false
            }
        }
    }

    return true
}

export function areDiffStatsEqual(a: DiffStats | undefined, b: DiffStats | undefined): boolean {
    if (a === b) return true
    if (!a || !b) return false

    for (const key of DIFF_STATS_KEYS) {
        if (a[key] !== b[key]) {
            return false
        }
    }
    return true
}

export function areArraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
    if (a === b) return true
    if (!a || !b) return a === b
    if (a.length !== b.length) return false
    return a.every((item, index) => item === b[index])
}
