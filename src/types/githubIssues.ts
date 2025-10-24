export interface GithubIssueLabel {
  name: string
  color?: string | null
}

export interface GithubIssueSummary {
  number: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: GithubIssueLabel[]
  url: string
}

export interface GithubIssueComment {
  author?: string | null
  createdAt: string
  body: string
}

export interface GithubIssueDetails {
  number: number
  title: string
  url: string
  body: string
  labels: GithubIssueLabel[]
  comments: GithubIssueComment[]
}

export interface GithubIssueSelectionResult {
  details: GithubIssueDetails
  prompt: string
}
