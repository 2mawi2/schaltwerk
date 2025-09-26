export interface GitHubRemote {
  remote_name: string
  owner: string
  repo: string
  host: string
}

export interface GitHubLinkedRepository {
  owner: string
  repo: string
  remote_name: string
}

export type GitHubPublishMode = 'squash' | 'keep'

export interface GitHubPublishContextResponse {
  remotes: GitHubRemote[]
  linked: GitHubLinkedRepository | null
  session_branch: string
  session_display_name?: string | null
  session_base_branch: string
  default_base_branch: string
  suggested_target_branch: string
  available_branches: string[]
  last_publish_mode?: string | null
  has_uncommitted_changes: boolean
  commit_message_suggestion: string
}

export interface GitHubPublishResponse {
  compare_url: string
  pushed_branch: string
  mode: string
}

export interface GitHubPublishCompletedPayload {
  session_name: string
  compare_url: string
  branch: string
  mode: string
}

export interface GitHubPublishFailedPayload {
  session_name: string
  error: string
}
