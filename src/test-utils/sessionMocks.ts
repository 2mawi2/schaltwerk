import { stableSessionTerminalId } from '../common/terminalIdentity'

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
    has_uncommitted_changes: false,
    ready_to_merge: readyToMerge,
    diff_stats: undefined,
    is_current: false,
    session_type: "worktree" as const,
  },
  terminals: [
    stableSessionTerminalId(name, 'top'),
    stableSessionTerminalId(name, 'bottom')
  ]
})
