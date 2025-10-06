import { sessionTerminalTopId, sessionTerminalBottomId } from '../utils/sessionTerminalIds'

export const mockEnrichedSession = (name: string, status: string = 'active', readyToMerge: boolean = false) => ({
  id: name,
  info: {
    session_id: name,
    display_name: name,
    branch: `branch-${name}`,
    worktree_path: `/path/to/${name}`,
    base_branch: 'main',
    status: status === 'spec' ? 'spec' : 'active',
    session_state: status,
    created_at: new Date().toISOString(),
    last_modified: new Date().toISOString(),
    has_uncommitted_changes: false,
    ready_to_merge: readyToMerge,
    diff_stats: undefined,
    is_current: false,
    session_type: "worktree" as const,
  },
  terminals: [
    sessionTerminalTopId(name),
    sessionTerminalBottomId(name)
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
    status: 'spec' as const,
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
