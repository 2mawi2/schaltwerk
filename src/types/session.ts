export const AGENT_TYPES = ['claude', 'opencode', 'gemini', 'codex'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export const AGENT_SUPPORTS_SKIP_PERMISSIONS: Record<AgentType, boolean> = {
    claude: true,
    opencode: false,
    gemini: true,
    codex: true
}

export enum SessionState {
    Spec = 'spec',
    Running = 'running',
    Reviewed = 'reviewed'
}

export interface SessionInfo {
    session_id: string
    display_name?: string
    version_group_id?: string
    version_number?: number
    branch: string
    worktree_path: string
    base_branch: string
    parent_branch?: string | null
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'spec'
    created_at?: string
    last_modified?: string
    last_modified_ts?: number
    has_uncommitted_changes?: boolean
    has_conflicts?: boolean
    merge_has_conflicts?: boolean
    merge_conflicting_paths?: string[]
    merge_is_up_to_date?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    session_state: SessionState | 'spec' | 'running' | 'reviewed'
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    ready_to_merge?: boolean
    spec_content?: string
    original_agent_type?: AgentType
    diff_stats?: DiffStats
    top_uncommitted_paths?: string[]
    attention_required?: boolean
}

export interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

export interface SessionMonitorStatus {
    session_name: string
    current_task: string
    test_status: 'passed' | 'failed' | 'unknown'
    diff_stats?: DiffStats
    last_update: string
}

export interface EnrichedSession {
    info: SessionInfo
    status?: SessionMonitorStatus
    terminals: string[]
}

// Raw Session type returned from Tauri backend (from schaltwerk_core_get_session)
export interface RawSession {
    id: string
    name: string
    display_name?: string
    version_group_id?: string
    version_number?: number
    repository_path: string
    repository_name: string
    branch: string
    parent_branch: string
    worktree_path: string
    status: 'active' | 'cancelled' | 'spec'
    created_at: string
    updated_at: string
    last_activity?: string
    initial_prompt?: string
    ready_to_merge: boolean
    original_agent_type?: AgentType
    original_skip_permissions?: boolean
    pending_name_generation: boolean
    was_auto_generated: boolean
    spec_content?: string
    session_state: 'spec' | 'running' | 'reviewed'
    git_stats?: {
        files_changed: number
        additions: number
        deletions: number
        insertions: number
    }
}

// Project selection returned from get_project_selection
export interface ProjectSelection {
    kind: string
    payload: string | null
}
