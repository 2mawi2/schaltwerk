export enum SchaltEvent {
  SessionsRefreshed = 'schaltwerk:sessions-refreshed',
  SessionAdded = 'schaltwerk:session-added',
  SessionRemoved = 'schaltwerk:session-removed',
  ArchiveUpdated = 'schaltwerk:archive-updated',
  SessionCancelling = 'schaltwerk:session-cancelling',
  CancelError = 'schaltwerk:cancel-error',
  ClaudeStarted = 'schaltwerk:claude-started',
  TerminalCreated = 'schaltwerk:terminal-created',

  SessionActivity = 'schaltwerk:session-activity',
  SessionGitStats = 'schaltwerk:session-git-stats',
  TerminalClosed = 'schaltwerk:terminal-closed',
  TerminalResumed = 'schaltwerk:terminal-resumed',
  TerminalAgentStarted = 'schaltwerk:terminal-agent-started',
  TerminalForceScroll = 'schaltwerk:terminal-force-scroll',
  ProjectReady = 'schaltwerk:project-ready',
  OpenDirectory = 'schaltwerk:open-directory',
  OpenHome = 'schaltwerk:open-home',
  FileChanges = 'schaltwerk:file-changes',
  FollowUpMessage = 'schaltwerk:follow-up-message',
  Selection = 'schaltwerk:selection',
  GitHubPublishCompleted = 'schaltwerk:github-publish-completed',
  GitHubPublishFailed = 'schaltwerk:github-publish-failed'
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
  top_uncommitted_paths?: string[]
}

export interface FollowUpMessagePayload {
  session_name: string
  message: string
  timestamp: number
  terminal_id: string
  message_type: 'system' | 'user'
}

export interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

export interface BranchInfo {
  current_branch: string
  base_branch: string
  base_commit: string
  head_commit: string
}

import { EnrichedSession } from '../types/session'
import type {
  GitHubPublishCompletedPayload as GitHubPublishCompletedPayloadType,
  GitHubPublishFailedPayload as GitHubPublishFailedPayloadType,
} from '../types/github'

export interface SelectionPayload {
  kind: 'session' | 'orchestrator'
  payload?: string
  worktreePath?: string
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export type GitHubPublishCompletedPayload = GitHubPublishCompletedPayloadType
export type GitHubPublishFailedPayload = GitHubPublishFailedPayloadType

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
  [SchaltEvent.ClaudeStarted]: { terminal_id: string, session_name: string }
  [SchaltEvent.TerminalCreated]: { terminal_id: string, cwd: string }

  [SchaltEvent.SessionActivity]: SessionActivityUpdated
  [SchaltEvent.SessionGitStats]: SessionGitStatsUpdated
  [SchaltEvent.TerminalClosed]: { terminal_id: string }
  [SchaltEvent.TerminalResumed]: { terminal_id: string }
  [SchaltEvent.TerminalAgentStarted]: { terminal_id: string, session_name?: string }
  [SchaltEvent.TerminalForceScroll]: { terminal_id: string }
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
  [SchaltEvent.GitHubPublishCompleted]: GitHubPublishCompletedPayload
  [SchaltEvent.GitHubPublishFailed]: GitHubPublishFailedPayload
}
