import { describe, it, expect } from 'vitest'
import {
  formatPrReviewCommentsForTerminal,
  formatPrReviewCommentsForClipboard,
  formatPrFeedbackForTerminal,
  type PrReviewComment
} from './githubPrFormatting'
import type { GithubPrFeedback } from '../../types/githubIssues'

describe('githubPrFormatting', () => {
  const createComment = (overrides: Partial<PrReviewComment> = {}): PrReviewComment => ({
    id: 1,
    path: 'src/test.ts',
    line: 10,
    body: 'Test comment',
    author: 'testuser',
    createdAt: '2024-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/owner/repo/pull/1#discussion_r1',
    inReplyToId: null,
    ...overrides
  })

  describe('formatPrReviewCommentsForTerminal', () => {
    it('formats a single comment correctly', () => {
      const comments = [createComment()]
      const result = formatPrReviewCommentsForTerminal(comments, 123)

      expect(result).toContain('# PR Review Comments (PR #123)')
      expect(result).toContain('## src/test.ts')
      expect(result).toContain('### Line 10:')
      expect(result).toContain('**@testuser:** Test comment')
    })

    it('groups comments by file', () => {
      const comments = [
        createComment({ id: 1, path: 'src/a.ts', body: 'Comment A' }),
        createComment({ id: 2, path: 'src/b.ts', body: 'Comment B' }),
        createComment({ id: 3, path: 'src/a.ts', body: 'Comment C', line: 20 })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('## src/a.ts')
      expect(result).toContain('## src/b.ts')
      expect(result).toContain('Comment A')
      expect(result).toContain('Comment B')
      expect(result).toContain('Comment C')
    })

    it('handles comments without line number', () => {
      const comments = [createComment({ line: null })]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('### General:')
    })

    it('handles comments without author', () => {
      const comments = [createComment({ author: null })]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('**Unknown:**')
    })

    it('formats replies correctly', () => {
      const comments = [
        createComment({ id: 1, body: 'Original comment' }),
        createComment({ id: 2, body: 'This is a reply', inReplyToId: 1, author: 'replier' })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('**@testuser:** Original comment')
      expect(result).toContain('> **@replier (reply):** This is a reply')
    })

    it('handles multiple replies to the same comment', () => {
      const comments = [
        createComment({ id: 1, body: 'Original' }),
        createComment({ id: 2, body: 'Reply 1', inReplyToId: 1, author: 'user1' }),
        createComment({ id: 3, body: 'Reply 2', inReplyToId: 1, author: 'user2' })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('> **@user1 (reply):** Reply 1')
      expect(result).toContain('> **@user2 (reply):** Reply 2')
    })
  })

  describe('formatPrReviewCommentsForClipboard', () => {
    it('formats comments for clipboard', () => {
      const comments = [
        createComment({ path: 'src/test.ts', line: 10, body: 'Comment 1', author: 'user1' }),
        createComment({ id: 2, path: 'src/other.ts', line: null, body: 'Comment 2', author: 'user2' })
      ]
      const result = formatPrReviewCommentsForClipboard(comments)

      expect(result).toContain('## src/test.ts:10')
      expect(result).toContain('**@user1**: Comment 1')
      expect(result).toContain('## src/other.ts')
      expect(result).toContain('**@user2**: Comment 2')
      expect(result).toContain('---')
    })

    it('handles empty author', () => {
      const comments = [createComment({ author: null })]
      const result = formatPrReviewCommentsForClipboard(comments)

      expect(result).toContain('**Unknown**')
    })
  })

  describe('formatPrFeedbackForTerminal', () => {
    const createFeedback = (overrides: Partial<GithubPrFeedback> = {}): GithubPrFeedback => ({
      state: 'OPEN',
      isDraft: false,
      reviewDecision: null,
      latestReviews: [],
      statusChecks: [],
      unresolvedThreads: [],
      resolvedThreadCount: 0,
      ...overrides
    })

    it('shows "no action items" when PR is clean', () => {
      const result = formatPrFeedbackForTerminal(createFeedback(), 42)

      expect(result).toContain('PR #42 Feedback: OPEN')
      expect(result).toContain('No action items found. PR looks ready.')
    })

    it('includes draft indicator', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({ isDraft: true }), 1)

      expect(result).toContain('(draft)')
    })

    it('shows review decision', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        reviewDecision: 'CHANGES_REQUESTED'
      }), 1)

      expect(result).toContain('Review: CHANGES_REQUESTED')
    })

    it('lists latest reviews', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        latestReviews: [
          { author: 'alice', state: 'APPROVED', submittedAt: '2024-01-01T00:00:00Z' },
          { author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: '2024-01-01T00:00:00Z' }
        ]
      }), 1)

      expect(result).toContain('## Reviews')
      expect(result).toContain('- alice: APPROVED')
      expect(result).toContain('- bob: CHANGES_REQUESTED')
    })

    it('shows failed and pending CI checks by name', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        statusChecks: [
          { name: 'Unit Tests', status: 'COMPLETED', conclusion: 'FAILURE' },
          { name: 'Lint', status: 'IN_PROGRESS', conclusion: null },
          { name: 'Build', status: 'COMPLETED', conclusion: 'SUCCESS' }
        ]
      }), 1)

      expect(result).toContain('## CI Checks')
      expect(result).toContain('- FAILED: Unit Tests')
      expect(result).toContain('- PENDING: Lint')
      expect(result).toContain('- 1 checks passed')
    })

    it('handles TIMED_OUT and CANCELLED conclusions as failed', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        statusChecks: [
          { name: 'Slow Test', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
          { name: 'Cancelled Job', status: 'COMPLETED', conclusion: 'CANCELLED' }
        ]
      }), 1)

      expect(result).toContain('- FAILED: Slow Test')
      expect(result).toContain('- FAILED: Cancelled Job')
    })

    it('formats unresolved review threads with file locations', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        unresolvedThreads: [
          {
            id: 'PRRT_thread1',
            isResolved: false,
            isOutdated: false,
            path: 'src/auth/login.ts',
            line: 42,
            comments: [
              { author: 'reviewer', body: 'Validate email format', createdAt: '2024-01-01T00:00:00Z' }
            ]
          },
          {
            id: 'PRRT_thread2',
            isResolved: false,
            isOutdated: false,
            path: 'src/utils.ts',
            line: null,
            comments: [
              { author: null, body: 'General feedback', createdAt: '2024-01-01T00:00:00Z' }
            ]
          }
        ],
        resolvedThreadCount: 3
      }), 1)

      expect(result).toContain('## Unresolved Review Threads')
      expect(result).toContain('### src/auth/login.ts:42 [thread:PRRT_thread1]')
      expect(result).toContain('**reviewer:** Validate email format')
      expect(result).toContain('### src/utils.ts [thread:PRRT_thread2]')
      expect(result).toContain('**Unknown:** General feedback')
      expect(result).toContain('2 unresolved threads (3 resolved)')
      expect(result).not.toContain('No action items found')
    })

    it('truncates comment bodies exceeding 500 characters', () => {
      const longBody = 'x'.repeat(600)
      const result = formatPrFeedbackForTerminal(createFeedback({
        unresolvedThreads: [{
          id: 'PRRT_long',
          isResolved: false,
          isOutdated: false,
          path: 'file.ts',
          line: 1,
          comments: [{ author: 'user', body: longBody, createdAt: '2024-01-01T00:00:00Z' }]
        }]
      }), 1)

      expect(result).toContain('x'.repeat(500) + '...')
      expect(result).not.toContain('x'.repeat(501))
    })

    it('shows summary header with all counts', () => {
      const result = formatPrFeedbackForTerminal(createFeedback({
        statusChecks: [
          { name: 'A', status: 'COMPLETED', conclusion: 'FAILURE' },
          { name: 'B', status: 'IN_PROGRESS', conclusion: null },
          { name: 'C', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'D', status: 'COMPLETED', conclusion: 'SUCCESS' }
        ],
        unresolvedThreads: [{
          id: 'PRRT_summary', isResolved: false, isOutdated: false, path: 'f.ts', line: 1,
          comments: [{ author: 'u', body: 'c', createdAt: '' }]
        }],
        resolvedThreadCount: 2
      }), 99)

      expect(result).toContain('PR #99 Feedback')
      expect(result).toContain('CI: 1 failed, 1 pending, 2 passed')
      expect(result).toContain('1 unresolved threads (2 resolved)')
    })
  })
})
