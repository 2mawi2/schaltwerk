import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'
import { logger } from '../../utils/logger'

const FILE_COMPLETION_PATTERN = /@[A-Za-z0-9_./-]*/
const MAX_COMPLETION_RESULTS = 40

export function createFileReferenceAutocomplete(provider: ProjectFileIndexApi): Extension {
  const completionSource = async (ctx: CompletionContext) => {
    const match = ctx.matchBefore(FILE_COMPLETION_PATTERN)
    if (!match) {
      return null
    }

    if (match.from > 0) {
      const preceding = ctx.state.doc.sliceString(match.from - 1, match.from)
      if (!/\s|[([{<>'"-]/.test(preceding)) {
        return null
      }
    }

    const query = match.text.slice(1)
    let files = provider.getSnapshot()

    if (files.length === 0) {
      try {
        files = await provider.ensureIndex()
      } catch (err) {
        logger.warn('[MarkdownEditor] Failed to ensure project file index', err)
        return null
      }
    }

    if (files.length === 0) {
      return null
    }

    const filtered = filterFilePaths(files, query)
    if (filtered.length === 0) {
      return null
    }

    const from = match.from
    const to = match.to
    const options: Completion[] = filtered.map(path => {
      const segments = path.split('/')
      const label = segments[segments.length - 1] || path
      const insertText = `@${path}`
      return {
        label,
        detail: path,
        type: 'text',
        apply(view) {
          view.dispatch({
            changes: {
              from,
              to,
              insert: insertText,
            },
          })
        },
      }
    })

    return {
      from,
      to,
      options,
      filter: false,
    }
  }

  return autocompletion({
    override: [completionSource],
    closeOnBlur: true,
  })
}

export function filterFilePaths(files: string[], query: string): string[] {
  if (!query) {
    return files.slice(0, MAX_COMPLETION_RESULTS)
  }

  const lowerQuery = query.toLowerCase()
  const results: string[] = []
  for (const path of files) {
    const segments = path.toLowerCase().split('/')
    if (segments.some(segment => segment.startsWith(lowerQuery))) {
      results.push(path)
      if (results.length >= MAX_COMPLETION_RESULTS) {
        break
      }
    }
  }
  return results
}
