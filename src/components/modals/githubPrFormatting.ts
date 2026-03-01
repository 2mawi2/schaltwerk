import type { GithubPrDetails, GithubPrFeedback, GithubPrSummary } from '../../types/githubIssues'
import { formatDateTime } from '../../utils/dateTime'

export interface PrReviewComment {
  id: number
  path: string
  line: number | null
  body: string
  author: string | null
  createdAt: string
  htmlUrl: string
  inReplyToId: number | null
}

export function formatPrReviewCommentsForTerminal(
  comments: PrReviewComment[],
  prNumber: number
): string {
  let formatted = `\n# PR Review Comments (PR #${prNumber})\n\n`

  const commentsByFile = comments.reduce((acc, c) => {
    if (!acc[c.path]) acc[c.path] = []
    acc[c.path].push(c)
    return acc
  }, {} as Record<string, PrReviewComment[]>)

  for (const [file, fileComments] of Object.entries(commentsByFile)) {
    formatted += `## ${file}\n\n`
    const topLevel = fileComments.filter(c => c.inReplyToId === null)
    const repliesById = new Map<number, PrReviewComment[]>()

    for (const c of fileComments) {
      if (c.inReplyToId !== null) {
        const existing = repliesById.get(c.inReplyToId) ?? []
        existing.push(c)
        repliesById.set(c.inReplyToId, existing)
      }
    }

    for (const c of topLevel) {
      const location = c.line ? `Line ${c.line}` : 'General'
      const author = c.author ? `@${c.author}` : 'Unknown'
      formatted += `### ${location}:\n**${author}:** ${c.body}\n\n`

      const threadReplies = repliesById.get(c.id) ?? []
      for (const reply of threadReplies) {
        const replyAuthor = reply.author ? `@${reply.author}` : 'Unknown'
        formatted += `  > **${replyAuthor} (reply):** ${reply.body}\n\n`
      }
    }
  }

  return formatted
}

export function formatPrReviewCommentsForClipboard(
  comments: PrReviewComment[]
): string {
  return comments.map(c => {
    const location = c.line ? `${c.path}:${c.line}` : c.path
    const author = c.author ? `@${c.author}` : 'Unknown'
    return `## ${location}\n**${author}**: ${c.body}`
  }).join('\n\n---\n\n')
}

export function buildPrPrompt(details: GithubPrDetails): string {
  const lines: string[] = [
    `GitHub Pull Request Context: ${details.title} (#${details.number})`,
    `Link: ${details.url}`,
    `Branch: ${details.headRefName}`,
  ]

  if (details.labels.length > 0) {
    const maxWidth = 80
    const labelTokens = details.labels.map(label => `[${label.name}]`)
    let currentLine = 'Labels:'
    labelTokens.forEach(token => {
      const tokenWithSpace = `${currentLine} ${token}`
      if (tokenWithSpace.length <= maxWidth) {
        currentLine = tokenWithSpace
      } else {
        lines.push(currentLine)
        currentLine = `        ${token}`
      }
    })
    lines.push(currentLine)
  }

  lines.push('')
  lines.push('PR Description:')
  lines.push(details.body.trim() ? details.body : '_No description provided._')

  if (details.comments.length > 0) {
    lines.push('')
    lines.push('---')
    lines.push('')
    details.comments.forEach(comment => {
      const author = comment.author?.trim() ? comment.author : 'Unknown author'
      lines.push(`Comment by ${author} (${comment.createdAt}):`)
      lines.push(comment.body.trim() ? comment.body : '_No comment provided._')
      lines.push('')
    })
  }

  return lines.join('\n').trim()
}

export function buildPrPreview(details: GithubPrDetails): string {
  const segments: string[] = []

  segments.push('### PR Description')
  segments.push(details.body.trim() ? details.body : '_No description provided._')

  if (details.labels.length > 0) {
    const labelTokens = details.labels.map(label => `\`${label.name}\``)
    segments.push('')
    segments.push(`**Labels:** ${labelTokens.join(' ')}`)
  }

  if (details.comments.length > 0) {
    segments.push('')
    segments.push('---')
    segments.push('')
    details.comments.forEach((comment, index) => {
      const author = comment.author?.trim() ? comment.author : 'Unknown author'
      segments.push(`**Comment ${index + 1}**`)
      segments.push(`_by ${author} on ${comment.createdAt}_`)
      segments.push('')
      segments.push(comment.body.trim() ? comment.body : '_No comment provided._')
      segments.push('')
    })
  }

  return segments.join('\n').trim()
}

export function formatPrUpdatedTimestamp(summary: GithubPrSummary): string {
  return formatDateTime(summary.updatedAt, undefined, summary.updatedAt)
}

export function formatPrFeedbackForTerminal(
  feedback: GithubPrFeedback,
  prNumber: number
): string {
  const lines: string[] = []

  const failedChecks = feedback.statusChecks.filter(c =>
    c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'CANCELLED'
  )
  const pendingChecks = feedback.statusChecks.filter(c =>
    !c.conclusion && c.status && c.status !== 'COMPLETED'
  )
  const passedCount = feedback.statusChecks.length - failedChecks.length - pendingChecks.length
  const threadCount = feedback.unresolvedThreads.length

  lines.push(`\nPR #${prNumber} Feedback: ${feedback.state}${feedback.isDraft ? ' (draft)' : ''} | Review: ${feedback.reviewDecision ?? 'none'} | ${threadCount} unresolved threads (${feedback.resolvedThreadCount} resolved) | CI: ${failedChecks.length} failed, ${pendingChecks.length} pending, ${passedCount} passed\n`)

  if (feedback.latestReviews.length > 0) {
    lines.push('## Reviews')
    for (const r of feedback.latestReviews) {
      lines.push(`- ${r.author ?? 'Unknown'}: ${r.state}`)
    }
    lines.push('')
  }

  if (failedChecks.length > 0 || pendingChecks.length > 0) {
    lines.push('## CI Checks')
    for (const c of failedChecks) {
      lines.push(`- FAILED: ${c.name ?? 'unnamed check'}`)
    }
    for (const c of pendingChecks) {
      lines.push(`- PENDING: ${c.name ?? 'unnamed check'}`)
    }
    if (passedCount > 0) {
      lines.push(`- ${passedCount} checks passed`)
    }
    lines.push('')
  }

  if (threadCount > 0) {
    lines.push('## Unresolved Review Threads')
    lines.push('Address each thread below:\n')
    for (const t of feedback.unresolvedThreads) {
      const location = t.line ? `${t.path}:${t.line}` : t.path
      lines.push(`### ${location} [thread:${t.id}]`)
      for (const c of t.comments) {
        const body = c.body.length > 500 ? c.body.substring(0, 500) + '...' : c.body
        lines.push(`**${c.author ?? 'Unknown'}:** ${body}`)
      }
      lines.push('')
    }
  }

  if (threadCount === 0 && failedChecks.length === 0 && pendingChecks.length === 0) {
    lines.push('No action items found. PR looks ready.')
  }

  return lines.join('\n')
}
