export interface GitlabSource {
  id: string
  label: string
  projectPath: string
  hostname: string
  issuesEnabled: boolean
  mrsEnabled: boolean
  pipelinesEnabled: boolean
}

export interface GitlabIssueSummary {
  iid: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: string[]
  url: string
  sourceLabel: string
}

export interface GitlabIssueDetails {
  iid: number
  title: string
  url: string
  description: string
  labels: string[]
  state: string
  notes: GitlabNote[]
  sourceLabel: string
}

export interface GitlabNote {
  author?: string | null
  createdAt: string
  body: string
}

export interface GitlabMrSummary {
  iid: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: string[]
  url: string
  sourceBranch: string
  targetBranch: string
  sourceLabel: string
}

export interface GitlabMrDetails {
  iid: number
  title: string
  url: string
  description: string
  labels: string[]
  state: string
  sourceBranch: string
  targetBranch: string
  mergeStatus?: string | null
  pipelineStatus?: string | null
  pipelineUrl?: string | null
  notes: GitlabNote[]
  reviewers: string[]
  sourceLabel: string
}

export interface GitlabPipelinePayload {
  id: number
  status: string
  url?: string | null
  duration?: number | null
}
