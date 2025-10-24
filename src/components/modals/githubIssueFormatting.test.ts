import { describe, expect, test } from 'vitest'
import type { GithubIssueDetails, GithubIssueSummary } from '../../types/githubIssues'
import { buildIssuePreview, buildIssuePrompt, formatIssueUpdatedTimestamp } from './githubIssueFormatting'

const baseDetails: GithubIssueDetails = {
  number: 42,
  title: 'Improve prompt flow',
  url: 'https://github.com/example/repo/issues/42',
  body: 'Issue body',
  labels: [],
  comments: [],
}

describe('githubIssueFormatting', () => {
  test('buildIssuePrompt returns a structured prompt with labels and comments', () => {
    const details: GithubIssueDetails = {
      ...baseDetails,
      labels: [{ name: 'bug' }, { name: 'frontend' }],
      comments: [
        { author: 'alice', createdAt: '2024-01-01T00:00:00Z', body: 'First comment' },
        { author: null, createdAt: '2024-01-02T00:00:00Z', body: '' },
      ],
    }

    const prompt = buildIssuePrompt(details)
    expect(prompt).toContain('GitHub Issue Context: Improve prompt flow (#42)')
    expect(prompt).toContain('Labels: [bug] [frontend]')
    expect(prompt).toContain('Comment by alice (2024-01-01T00:00:00Z):')
    expect(prompt).toContain('First comment')
    expect(prompt).toContain('Comment by Unknown author (2024-01-02T00:00:00Z):')
    expect(prompt).toContain('_No comment provided._')
  })

  test('buildIssuePreview produces markdown with labels and comments', () => {
    const details: GithubIssueDetails = {
      ...baseDetails,
      body: '',
      labels: [{ name: 'enhancement' }],
      comments: [{ author: 'bob', createdAt: '2024-01-03T12:00:00Z', body: 'Looks good' }],
    }

    const preview = buildIssuePreview(details)
    expect(preview).toContain('_No description provided._')
    expect(preview).toContain('**Labels:** `enhancement`')
    expect(preview).toContain('**Comment 1**')
    expect(preview).toContain('_by bob on 2024-01-03T12:00:00Z_')
    expect(preview).toContain('Looks good')
  })

  test('formatIssueUpdatedTimestamp falls back to raw string when invalid', () => {
    const summary: GithubIssueSummary = {
      number: 1,
      title: 'Invalid date',
      state: 'OPEN',
      updatedAt: 'not-a-date',
      author: null,
      labels: [],
      url: 'https://github.com/example/repo/issues/1',
    }

    expect(formatIssueUpdatedTimestamp(summary)).toBe('not-a-date')
  })
})
