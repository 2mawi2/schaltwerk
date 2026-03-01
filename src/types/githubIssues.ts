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

export interface GithubPrSummary {
  number: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: GithubIssueLabel[]
  url: string
  headRefName: string
}

export interface GithubPrReview {
  author?: string | null
  state: string
  submittedAt: string
}

export interface GithubPrDetails {
  number: number
  title: string
  url: string
  body: string
  labels: GithubIssueLabel[]
  comments: GithubIssueComment[]
  headRefName: string
  reviewDecision?: string | null
  statusCheckState?: string | null
  latestReviews: GithubPrReview[]
  isFork: boolean
}

export interface GithubPrSelectionResult {
  details: GithubPrDetails
  prompt: string
}

export interface GithubReviewThreadComment {
  author: string | null
  body: string
  createdAt: string
}

export interface GithubReviewThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  comments: GithubReviewThreadComment[]
}

export interface GithubStatusCheck {
  name: string | null
  status: string | null
  conclusion: string | null
}

export interface GithubPrFeedback {
  state: string
  isDraft: boolean
  reviewDecision: string | null
  latestReviews: GithubPrReview[]
  statusChecks: GithubStatusCheck[]
  unresolvedThreads: GithubReviewThread[]
  resolvedThreadCount: number
}
