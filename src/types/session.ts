export type AgentType = 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'

export interface SessionInfo {
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
    session_state: 'spec' | 'running' | 'reviewed'
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    ready_to_merge?: boolean
    spec_content?: string
    original_agent_type?: AgentType
    diff_stats?: DiffStats
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