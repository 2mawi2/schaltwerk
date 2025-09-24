import { countTokens } from 'gpt-tokenizer'
import type { ChangedFile } from '../../common/events'
import type { DiffResponse, LineInfo } from '../../types/diff'
import { logger } from '../../utils/logger'

export function wrapBlock(header: string, body: string, fence: string | null): string {
  return `${header}\n\n${fence ? `\`\`\`${fence}\n${body}\n\`\`\`` : body}`
}

export function describeChange(change: ChangedFile): string {
  switch (change.change_type) {
    case 'added':
      return `${change.path} (added)`
    case 'deleted':
      return `${change.path} (deleted)`
    case 'renamed':
      return `${change.path} (renamed)`
    case 'copied':
      return `${change.path} (copied)`
    case 'modified':
      return `${change.path} (modified)`
    case 'unknown':
      return `${change.path} (changed)`
    default:
      return change.path
  }
}

export function flattenDiffLines(lines: LineInfo[]): string[] {
  const result: string[] = []
  for (const line of lines) {
    if (line.isCollapsible && Array.isArray(line.collapsedLines)) {
      const nestedLines = line.collapsedLines
      const hasNonUnchanged = nestedLines.some(nested => nested.type !== 'unchanged')
      if (hasNonUnchanged) {
        for (const nested of nestedLines) {
          result.push(`${prefixForDiffLine(nested)}${nested.content ?? ''}`)
        }
      } else {
        const collapsedCount = typeof line.collapsedCount === 'number' && line.collapsedCount > 0
          ? line.collapsedCount
          : nestedLines.length
        const summary = collapsedCount > 0
          ? `[unchanged lines omitted: ${collapsedCount}]`
          : '[unchanged lines omitted]'
        result.push(` ${summary}`)
      }
    } else {
      result.push(`${prefixForDiffLine(line)}${line.content ?? ''}`)
    }
  }
  return result
}

function prefixForDiffLine(line: LineInfo): string {
  switch (line.type) {
    case 'added':
      return '+'
    case 'removed':
      return '-'
    default:
      return ' '
  }
}

export function computeTokens(text: string): number | null {
  try {
    return countTokens(text)
  } catch (err) {
    logger.error('[bundleUtils] Tokenization failed', err)
    return null
  }
}

export interface BundleSection {
  header: string
  body: string
  fence: string | null
}

export function buildSpecSection(specText: string): BundleSection {
  return {
    header: '## Spec',
    body: specText,
    fence: ''
  }
}

export function buildDiffSections(changedFiles: ChangedFile[], fetchDiff: (filePath: string) => Promise<DiffResponse>): Promise<BundleSection[]> {
  return Promise.all(
    changedFiles.map(async (file) => {
      try {
        const diff = await fetchDiff(file.path)
        if (diff?.isBinary) {
          return {
            header: `### ${describeChange(file)}`,
            body: 'diff not available (binary file)',
            fence: 'diff'
          }
        }
        const diffLines = Array.isArray(diff?.lines) ? flattenDiffLines(diff.lines) : []
        const diffBody = diffLines.join('\n') || 'No diff available'
        return {
          header: `### ${describeChange(file)}`,
          body: diffBody,
          fence: 'diff'
        }
      } catch (err) {
        logger.error('[bundleUtils] Failed to load diff for', file.path, err)
        return {
          header: `### ${describeChange(file)}`,
          body: 'Error loading diff',
          fence: 'diff'
        }
      }
    })
  )
}

export function buildFileSections(changedFiles: ChangedFile[], fetchFileContents: (filePath: string) => Promise<{ base: string; head: string }>): Promise<BundleSection[]> {
  return Promise.all(
    changedFiles.map(async (file) => {
      try {
        const { base, head } = await fetchFileContents(file.path)
        const isDeleted = file.change_type === 'deleted'
        const content = isDeleted ? base : head
        const body = (content ?? '').trimEnd() || (isDeleted ? '[File deleted]' : '[No content available]')
        return {
          header: `### ${describeChange(file)}`,
          body,
          fence: ''
        }
      } catch (err) {
        logger.error('[bundleUtils] Failed to load file contents for', file.path, err)
        return {
          header: `### ${describeChange(file)}`,
          body: '[Error loading content]',
          fence: ''
        }
      }
    })
  )
}
