export const mockEnrichedSession = (name: string, status: string = 'active', readyToMerge: boolean = false) => ({
    id: name,
    info: {
        session_id: name,
        display_name: name,
        branch: `branch-${name}`,
        worktree_path: `/path/to/${name}`,
        base_branch: 'main',
        status: status as any,
        session_state: status,
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
        has_uncommitted_changes: false,
        ready_to_merge: readyToMerge,
        diff_stats: undefined,
        is_current: false,
        session_type: 'worktree' as const,
    },
    terminals: [
        `session-${name}-top`,
        `session-${name}-bottom`
    ]
})

export const mockDraftSession = (name: string) => ({
    id: name,
    info: {
        session_id: name,
        display_name: name,
        branch: `branch-${name}`,
        worktree_path: `/path/to/${name}`,
        base_branch: 'main',
        status: 'spec' as any,
        session_state: 'spec',
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
        has_uncommitted_changes: false,
        ready_to_merge: false,
        diff_stats: undefined,
        is_current: false,
        session_type: 'worktree' as const,
    },
    terminals: []
})