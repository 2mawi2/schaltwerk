import type {
  FileDiffMetadata,
  Hunk,
  ContextContent,
  ChangeContent,
  ChangeTypes,
  SupportedLanguages,
} from '@pierre/diffs'
import type { LineInfo, DiffResponse, DiffStats } from '../types/diff'

export interface CollapsedSection {
  index: number
  count: number
  lines: LineInfo[]
  oldLineStart: number
  newLineStart: number
}

export interface ConvertedDiff {
  fileDiff: FileDiffMetadata
  stats: DiffStats
  collapsedSections: CollapsedSection[]
}

function getLanguageFromExtension(language?: string): SupportedLanguages {
  if (!language) return 'text'

  const languageMap: Record<string, SupportedLanguages> = {
    javascript: 'javascript',
    typescript: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    python: 'python',
    rust: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    csharp: 'csharp',
    ruby: 'ruby',
    php: 'php',
    swift: 'swift',
    kotlin: 'kotlin',
    scala: 'scala',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    xml: 'xml',
    markdown: 'markdown',
    sql: 'sql',
    shell: 'shellscript',
    bash: 'shellscript',
    dockerfile: 'dockerfile',
    toml: 'toml',
    ini: 'ini',
    vue: 'vue',
    svelte: 'svelte',
  }

  return languageMap[language.toLowerCase()] ?? 'text'
}

function determineChangeType(lines: LineInfo[]): ChangeTypes {
  const hasAdditions = lines.some((l) => l.type === 'added')
  const hasDeletions = lines.some((l) => l.type === 'removed')

  if (hasAdditions && !hasDeletions) return 'new'
  if (hasDeletions && !hasAdditions) return 'deleted'
  return 'change'
}

interface HunkBuilder {
  content: (ContextContent | ChangeContent)[]
  contextLines: string[]
  deletions: string[]
  additions: string[]
  additionCount: number
  deletionCount: number
  contextCount: number
  oldLineStart: number
  newLineStart: number
}

function createHunkBuilder(oldLineStart: number, newLineStart: number): HunkBuilder {
  return {
    content: [],
    contextLines: [],
    deletions: [],
    additions: [],
    additionCount: 0,
    deletionCount: 0,
    contextCount: 0,
    oldLineStart,
    newLineStart,
  }
}

function flushHunkContext(builder: HunkBuilder): void {
  if (builder.contextLines.length > 0) {
    builder.content.push({
      type: 'context',
      lines: builder.contextLines,
      noEOFCR: false,
    })
    builder.contextLines = []
  }
}

function flushHunkChanges(builder: HunkBuilder): void {
  if (builder.deletions.length > 0 || builder.additions.length > 0) {
    builder.content.push({
      type: 'change',
      deletions: builder.deletions,
      additions: builder.additions,
      noEOFCRDeletions: false,
      noEOFCRAdditions: false,
    })
    builder.deletions = []
    builder.additions = []
  }
}

function finalizeHunk(builder: HunkBuilder, collapsedBefore: number, unifiedLineStart: number): Hunk | null {
  flushHunkContext(builder)
  flushHunkChanges(builder)

  if (builder.content.length === 0) {
    return null
  }

  const oldLineCount = builder.contextCount + builder.deletionCount
  const newLineCount = builder.contextCount + builder.additionCount

  return {
    collapsedBefore,
    splitLineStart: builder.oldLineStart,
    splitLineCount: Math.max(oldLineCount, newLineCount),
    unifiedLineStart,
    unifiedLineCount: builder.contextCount + builder.deletionCount + builder.additionCount,
    additionCount: builder.additionCount,
    additionStart: builder.newLineStart,
    additionLines: builder.additionCount,
    deletionCount: builder.deletionCount,
    deletionStart: builder.oldLineStart,
    deletionLines: builder.deletionCount,
    hunkContent: builder.content,
    hunkContext: undefined,
    hunkSpecs: undefined,
  }
}

interface ConversionResult {
  hunks: Hunk[]
  collapsedSections: CollapsedSection[]
}

function convertLinesToHunks(lines: LineInfo[]): ConversionResult {
  const hunks: Hunk[] = []
  const collapsedSections: CollapsedSection[] = []

  if (lines.length === 0) {
    return { hunks, collapsedSections }
  }

  let unifiedLineNum = 1
  let collapsedBefore = 0
  let builder: HunkBuilder | null = null
  let sectionIndex = 0

  for (const line of lines) {
    if (line.isCollapsible) {
      if (builder) {
        const hunk = finalizeHunk(builder, collapsedBefore, unifiedLineNum - (builder.contextCount + builder.deletionCount + builder.additionCount))
        if (hunk) {
          hunks.push(hunk)
        }
        builder = null
        collapsedBefore = 0
      }

      const count = line.collapsedCount ?? 0
      const oldLineStart = line.oldLineNumber ?? unifiedLineNum
      const newLineStart = line.newLineNumber ?? unifiedLineNum
      collapsedSections.push({
        index: sectionIndex++,
        count,
        lines: line.collapsedLines ?? [],
        oldLineStart,
        newLineStart,
      })
      collapsedBefore = count
      unifiedLineNum += count
      continue
    }

    if (!builder) {
      const oldLineStart = line.oldLineNumber ?? unifiedLineNum
      const newLineStart = line.newLineNumber ?? unifiedLineNum
      builder = createHunkBuilder(oldLineStart, newLineStart)
    }

    const content = line.content ?? ''
    const contentWithNewline = content + '\n'

    switch (line.type) {
      case 'unchanged':
        flushHunkChanges(builder)
        builder.contextLines.push(contentWithNewline)
        builder.contextCount++
        unifiedLineNum++
        break

      case 'removed':
        flushHunkContext(builder)
        builder.deletions.push(contentWithNewline)
        builder.deletionCount++
        unifiedLineNum++
        break

      case 'added':
        flushHunkContext(builder)
        builder.additions.push(contentWithNewline)
        builder.additionCount++
        unifiedLineNum++
        break
    }
  }

  if (builder) {
    const hunk = finalizeHunk(builder, collapsedBefore, unifiedLineNum - (builder.contextCount + builder.deletionCount + builder.additionCount))
    if (hunk) {
      hunks.push(hunk)
    }
  }

  return { hunks, collapsedSections }
}

const diffConversionCache = new Map<string, ConvertedDiff>()

function countLines(lines: LineInfo[]): { oldLineCount: number; newLineCount: number; totalUnified: number } {
  let oldLineCount = 0
  let newLineCount = 0
  let totalUnified = 0

  for (const line of lines) {
    if (line.isCollapsible) {
      const count = line.collapsedCount ?? 0
      oldLineCount += count
      newLineCount += count
      totalUnified += count
      continue
    }

    switch (line.type) {
      case 'unchanged':
        oldLineCount++
        newLineCount++
        totalUnified++
        break
      case 'removed':
        oldLineCount++
        totalUnified++
        break
      case 'added':
        newLineCount++
        totalUnified++
        break
    }
  }

  return { oldLineCount, newLineCount, totalUnified }
}

export function convertDiffResponseToFileDiffMetadata(
  response: DiffResponse,
  filePath: string,
  expandedSections?: Set<number>
): ConvertedDiff {
  const expandedKey = expandedSections ? Array.from(expandedSections).sort().join(',') : ''
  const cacheKey = `${filePath}-${response.stats.additions}-${response.stats.deletions}-${response.lines.length}-${expandedKey}`
  const cached = diffConversionCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const linesToConvert = expandedSections
    ? expandLinesWithSections(response.lines, expandedSections)
    : response.lines

  const { hunks, collapsedSections } = convertLinesToHunks(linesToConvert)
  const language = getLanguageFromExtension(response.fileInfo.language)
  const changeType = determineChangeType(response.lines)

  const { oldLineCount, newLineCount, totalUnified } = countLines(linesToConvert)

  const fileDiff: FileDiffMetadata = {
    name: filePath,
    prevName: undefined,
    lang: language,
    type: changeType,
    hunks,
    splitLineCount: Math.max(oldLineCount, newLineCount),
    unifiedLineCount: totalUnified,
    cacheKey,
  }

  const result: ConvertedDiff = {
    fileDiff,
    stats: response.stats,
    collapsedSections,
  }

  diffConversionCache.set(cacheKey, result)

  if (diffConversionCache.size > 100) {
    const firstKey = diffConversionCache.keys().next().value
    if (firstKey) diffConversionCache.delete(firstKey)
  }

  return result
}

function expandLinesWithSections(lines: LineInfo[], expandedSections: Set<number>): LineInfo[] {
  const result: LineInfo[] = []
  let sectionIndex = 0

  for (const line of lines) {
    if (line.isCollapsible) {
      if (expandedSections.has(sectionIndex)) {
        if (line.collapsedLines) {
          result.push(...line.collapsedLines)
        }
      } else {
        result.push(line)
      }
      sectionIndex++
    } else {
      result.push(line)
    }
  }

  return result
}

export function createEmptyFileDiff(filePath: string): FileDiffMetadata {
  return {
    name: filePath,
    prevName: undefined,
    lang: 'text',
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
  }
}

export function createBinaryFileDiff(filePath: string): FileDiffMetadata {
  return {
    name: filePath,
    prevName: undefined,
    lang: 'text',
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
  }
}
