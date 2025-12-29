export interface SpecReviewComment {
  id: string
  specId: string
  lineRange: { start: number; end: number }
  selectedText: string
  comment: string
  timestamp: number
}

export interface SpecReviewSession {
  specId: string
  specDisplayName: string
  comments: SpecReviewComment[]
  createdAt: number
}
