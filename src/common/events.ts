export enum SchaltEvent {
  SessionsRefreshed = 'schaltwerk:sessions-refreshed',
  SessionAdded = 'schaltwerk:session-added',
  SessionRemoved = 'schaltwerk:session-removed',
  SessionCancelling = 'schaltwerk:session-cancelling',
  CancelError = 'schaltwerk:cancel-error',
  ClaudeStarted = 'schaltwerk:claude-started',
  TerminalStuck = 'schaltwerk:terminal-stuck',
  TerminalUnstuck = 'schaltwerk:terminal-unstuck',
  SessionActivity = 'schaltwerk:session-activity',
  SessionGitStats = 'schaltwerk:session-git-stats',
  TerminalClosed = 'schaltwerk:terminal-closed',
  ProjectReady = 'schaltwerk:project-ready',
  OpenDirectory = 'schaltwerk:open-directory',
  OpenHome = 'schaltwerk:open-home',
  FileChanges = 'schaltwerk:file-changes',
  FollowUpMessage = 'schaltwerk:follow-up-message',
  Selection = 'schaltwerk:selection'
}


export interface SessionActivityUpdated {
  session_id: string
  session_name: string
  last_activity_ts: number
  current_task: string | null
  todo_percentage: number | null
  is_blocked: boolean | null
}

export interface SessionGitStatsUpdated {
  session_id: string
  session_name: string
  files_changed: number
  lines_added: number
  lines_removed: number
  has_uncommitted: boolean
}

export interface FollowUpMessagePayload {
  session_name: string
  message: string
  timestamp: number
  terminal_id: string
  message_type: 'system' | 'user'
}

export type EventPayloadMap = {
  [SchaltEvent.SessionsRefreshed]: any[]
  [SchaltEvent.SessionAdded]: { session_name: string, branch: string, worktree_path: string, parent_branch: string }
  [SchaltEvent.SessionRemoved]: { session_name: string }
  [SchaltEvent.SessionCancelling]: { session_name: string }
  [SchaltEvent.CancelError]: { session_name: string, error: string }
  [SchaltEvent.ClaudeStarted]: { terminal_id: string, session_name: string }
  [SchaltEvent.TerminalStuck]: { terminal_id: string, time: string }
  [SchaltEvent.TerminalUnstuck]: { terminal_id: string, time: string }
  [SchaltEvent.SessionActivity]: SessionActivityUpdated
  [SchaltEvent.SessionGitStats]: SessionGitStatsUpdated
  [SchaltEvent.TerminalClosed]: { terminal_id: string }
  [SchaltEvent.ProjectReady]: string
  [SchaltEvent.OpenDirectory]: string
  [SchaltEvent.OpenHome]: string
  [SchaltEvent.FileChanges]: any
  [SchaltEvent.FollowUpMessage]: FollowUpMessagePayload
  [SchaltEvent.Selection]: any
}