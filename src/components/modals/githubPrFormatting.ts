import type { GithubPrDetails, GithubPrSummary } from '../../types/githubIssues'
import { formatDateTime } from '../../utils/dateTime'

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
