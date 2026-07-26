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
  unifiedLineStart: number
  additionLineIndex: number
  deletionLineIndex: number
}

function createHunkBuilder(
  oldLineStart: number,
  newLineStart: number,
  unifiedLineStart: number,
  additionLineIndex: number,
  deletionLineIndex: number
): HunkBuilder {
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
    unifiedLineStart,
    additionLineIndex,
    deletionLineIndex,
  }
}

function flushHunkContext(
  builder: HunkBuilder,
  additionLines: string[],
  deletionLines: string[]
): void {
  if (builder.contextLines.length > 0) {
    const additionLineIndex = additionLines.length
    const deletionLineIndex = deletionLines.length
    additionLines.push(...builder.contextLines)
    deletionLines.push(...builder.contextLines)
    builder.content.push({
      type: 'context',
      lines: builder.contextLines.length,
      additionLineIndex,
      deletionLineIndex,
    })
    builder.contextLines = []
  }
}

function flushHunkChanges(
  builder: HunkBuilder,
  additionLines: string[],
  deletionLines: string[]
): void {
  if (builder.deletions.length > 0 || builder.additions.length > 0) {
    const additionLineIndex = additionLines.length
    const deletionLineIndex = deletionLines.length
    additionLines.push(...builder.additions)
    deletionLines.push(...builder.deletions)
    builder.content.push({
      type: 'change',
      deletions: builder.deletions.length,
      additions: builder.additions.length,
      additionLineIndex,
      deletionLineIndex,
    })
    builder.deletions = []
    builder.additions = []
  }
}

function finalizeHunk(
  builder: HunkBuilder,
  collapsedBefore: number,
  additionLines: string[],
  deletionLines: string[]
): Hunk | null {
  flushHunkContext(builder, additionLines, deletionLines)
  flushHunkChanges(builder, additionLines, deletionLines)

  if (builder.content.length === 0) {
    return null
  }

  const oldLineCount = builder.contextCount + builder.deletionCount
  const newLineCount = builder.contextCount + builder.additionCount

  return {
    collapsedBefore,
    splitLineStart: Math.max(0, Math.min(builder.oldLineStart, builder.newLineStart) - 1),
    splitLineCount: Math.max(oldLineCount, newLineCount),
    unifiedLineStart: builder.unifiedLineStart,
    unifiedLineCount: builder.contextCount + builder.deletionCount + builder.additionCount,
    additionCount: newLineCount,
    additionStart: builder.newLineStart,
    additionLines: builder.additionCount,
    additionLineIndex: builder.additionLineIndex,
    deletionCount: oldLineCount,
    deletionStart: builder.oldLineStart,
    deletionLines: builder.deletionCount,
    deletionLineIndex: builder.deletionLineIndex,
    hunkContent: builder.content,
    hunkContext: undefined,
    hunkSpecs: undefined,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
  }
}

interface ConversionResult {
  hunks: Hunk[]
  collapsedSections: CollapsedSection[]
  additionLines: string[]
  deletionLines: string[]
}

function convertLinesToHunks(lines: LineInfo[]): ConversionResult {
  const hunks: Hunk[] = []
  const collapsedSections: CollapsedSection[] = []
  const additionLines: string[] = []
  const deletionLines: string[] = []

  if (lines.length === 0) {
    return { hunks, collapsedSections, additionLines, deletionLines }
  }

  let unifiedLineNum = 0
  let collapsedBefore = 0
  let builder: HunkBuilder | null = null
  let sectionIndex = 0

  for (const line of lines) {
    if (line.isCollapsible) {
      if (builder) {
        const hunk = finalizeHunk(builder, collapsedBefore, additionLines, deletionLines)
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
      const oldLineStart = line.oldLineNumber ?? line.newLineNumber ?? unifiedLineNum + 1
      const newLineStart = line.newLineNumber ?? line.oldLineNumber ?? unifiedLineNum + 1
      builder = createHunkBuilder(
        oldLineStart,
        newLineStart,
        unifiedLineNum,
        additionLines.length,
        deletionLines.length
      )
    }

    const content = line.content ?? ''
    const contentWithNewline = content + '\n'

    switch (line.type) {
      case 'unchanged':
        flushHunkChanges(builder, additionLines, deletionLines)
        builder.contextLines.push(contentWithNewline)
        builder.contextCount++
        unifiedLineNum++
        break

      case 'removed':
        flushHunkContext(builder, additionLines, deletionLines)
        builder.deletions.push(contentWithNewline)
        builder.deletionCount++
        unifiedLineNum++
        break

      case 'added':
        flushHunkContext(builder, additionLines, deletionLines)
        builder.additions.push(contentWithNewline)
        builder.additionCount++
        unifiedLineNum++
        break
    }
  }

  if (builder) {
    const hunk = finalizeHunk(builder, collapsedBefore, additionLines, deletionLines)
    if (hunk) {
      hunks.push(hunk)
    }
  }

  return { hunks, collapsedSections, additionLines, deletionLines }
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

  const { hunks, collapsedSections, additionLines, deletionLines } =
    convertLinesToHunks(linesToConvert)
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
    isPartial: true,
    deletionLines,
    additionLines,
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
    isPartial: true,
    deletionLines: [],
    additionLines: [],
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
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  }
}
