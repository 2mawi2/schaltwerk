export enum SchaltEvent {
  SessionsRefreshed = 'schaltwerk:sessions-refreshed',
  SessionAdded = 'schaltwerk:session-added',
  SessionRemoved = 'schaltwerk:session-removed',
  ArchiveUpdated = 'schaltwerk:archive-updated',
  SessionCancelling = 'schaltwerk:session-cancelling',
  CancelError = 'schaltwerk:cancel-error',
  TerminalCreated = 'schaltwerk:terminal-created',

  SessionActivity = 'schaltwerk:session-activity',
  SessionGitStats = 'schaltwerk:session-git-stats',
  TerminalAttention = 'schaltwerk:terminal-attention',
  TerminalClosed = 'schaltwerk:terminal-closed',
  TerminalAgentStarted = 'schaltwerk:terminal-agent-started',
  TerminalForceScroll = 'schaltwerk:terminal-force-scroll',
  PtyData = 'schaltwerk:pty-data',
  ProjectReady = 'schaltwerk:project-ready',
  OpenDirectory = 'schaltwerk:open-directory',
  OpenHome = 'schaltwerk:open-home',
  FileChanges = 'schaltwerk:file-changes',
  FollowUpMessage = 'schaltwerk:follow-up-message',
  Selection = 'schaltwerk:selection',
  GitOperationStarted = 'schaltwerk:git-operation-started',
  GitOperationCompleted = 'schaltwerk:git-operation-completed',
  GitOperationFailed = 'schaltwerk:git-operation-failed',
  ProjectFilesUpdated = 'schaltwerk:project-files-updated',
  GitHubStatusChanged = 'schaltwerk:github-status-changed',
  AppUpdateResult = 'schaltwerk:app-update-result',
  DevBackendError = 'schaltwerk:dev-backend-error'
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
  has_conflicts?: boolean
  top_uncommitted_paths?: string[]
  merge_has_conflicts?: boolean
  merge_conflicting_paths?: string[]
  merge_is_up_to_date?: boolean
  worktree_size_bytes?: number
}

export interface FollowUpMessagePayload {
  session_name: string
  message: string
  timestamp: number
  terminal_id: string
  message_type: 'system' | 'user'
}

export interface PtyDataPayload {
  term_id: string
  seq: number
  base64: string
}

export interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
  additions: number
  deletions: number
  changes: number
  is_binary?: boolean
  previous_path?: string
}

export interface BranchInfo {
  current_branch: string
  base_branch: string
  base_commit: string
  head_commit: string
}

export interface GitOperationPayload {
  session_name: string
  session_branch: string
  parent_branch: string
  mode: string
  operation: 'merge'
  commit?: string
  status?: 'started' | 'success' | 'conflict' | 'error'
}

export interface GitOperationFailedPayload extends GitOperationPayload {
  error: string
}

export interface GitHubRepositoryPayload {
  nameWithOwner: string
  defaultBranch: string
}

export interface GitHubStatusPayload {
  installed: boolean
  authenticated: boolean
  userLogin?: string | null
  repository?: GitHubRepositoryPayload | null
}

export interface GitHubPrPayload {
  branch: string
  url: string
}

export type UpdateResultStatus = 'updated' | 'upToDate' | 'error' | 'busy'
export type UpdateInitiator = 'auto' | 'manual'
export type UpdateErrorKind = 'network' | 'permission' | 'signature' | 'unknown'

export interface AppUpdateResultPayload {
  status: UpdateResultStatus
  initiatedBy: UpdateInitiator
  currentVersion: string
  newVersion?: string
  notes?: string | null
  errorKind?: UpdateErrorKind
  errorMessage?: string
}

export interface DevBackendErrorPayload {
  message: string
  source?: string
}

import { EnrichedSession } from '../types/session'

export interface SelectionPayload {
  kind: 'session' | 'orchestrator'
  payload?: string
  worktreePath?: string
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export type EventPayloadMap = {
  [SchaltEvent.SessionsRefreshed]: EnrichedSession[]
  [SchaltEvent.SessionAdded]: {
    session_name: string
    branch: string
    worktree_path: string
    parent_branch: string
    created_at: string
    last_modified?: string
  }
  [SchaltEvent.SessionRemoved]: { session_name: string }
  [SchaltEvent.ArchiveUpdated]: { repo: string, count: number }
  [SchaltEvent.SessionCancelling]: { session_name: string }
  [SchaltEvent.CancelError]: { session_name: string, error: string }
  [SchaltEvent.TerminalCreated]: { terminal_id: string, cwd: string }

  [SchaltEvent.SessionActivity]: SessionActivityUpdated
  [SchaltEvent.SessionGitStats]: SessionGitStatsUpdated
  [SchaltEvent.TerminalAttention]: { session_id: string, terminal_id: string, needs_attention: boolean }
  [SchaltEvent.TerminalClosed]: { terminal_id: string }
  [SchaltEvent.TerminalAgentStarted]: { terminal_id: string, session_name?: string }
  [SchaltEvent.TerminalForceScroll]: { terminal_id: string }
  [SchaltEvent.PtyData]: PtyDataPayload
  [SchaltEvent.ProjectReady]: string
  [SchaltEvent.OpenDirectory]: string
  [SchaltEvent.OpenHome]: string
  [SchaltEvent.FileChanges]: {
    session_name: string
    changed_files: ChangedFile[]
    branch_info: BranchInfo
  }
  [SchaltEvent.FollowUpMessage]: FollowUpMessagePayload
  [SchaltEvent.Selection]: SelectionPayload
  [SchaltEvent.GitOperationStarted]: GitOperationPayload
  [SchaltEvent.GitOperationCompleted]: GitOperationPayload
  [SchaltEvent.GitOperationFailed]: GitOperationFailedPayload
  [SchaltEvent.ProjectFilesUpdated]: string[]
  [SchaltEvent.GitHubStatusChanged]: GitHubStatusPayload
  [SchaltEvent.AppUpdateResult]: AppUpdateResultPayload
  [SchaltEvent.DevBackendError]: DevBackendErrorPayload
}
