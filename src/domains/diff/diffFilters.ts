import { minimatch } from 'minimatch'

const GENERATED_FILE_PATTERNS = [
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.venv/**',
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  '*.pb.go',
  '*.pb.ts',
  '*.generated.ts',
  'node_modules/**',
  'vendor/**'
]

const LARGE_DIFF_LINE_THRESHOLD = 500
const LARGE_DIFF_SIZE_THRESHOLD = 100 * 1024
const COMPACT_VIEW_SAFE_LINE_THRESHOLD = 200

export interface DiffFilterResult {
  isGenerated: boolean
  isLarge: boolean
  shouldCollapse: boolean
  reason?: 'generated' | 'large' | 'both' | 'deleted'
  lineCount?: number
  sizeBytes?: number
}

export function isGeneratedFile(filePath: string): boolean {
  return GENERATED_FILE_PATTERNS.some(pattern =>
    minimatch(filePath, pattern, { matchBase: true })
  )
}

export function isLargeDiff(lineCount: number, sizeBytes: number): boolean {
  return lineCount > LARGE_DIFF_LINE_THRESHOLD || sizeBytes > LARGE_DIFF_SIZE_THRESHOLD
}

export function shouldCollapseDiff(
  filePath: string,
  lineCount: number,
  sizeBytes: number,
  options: {
    alwaysShowLargeDiffs: boolean
    isCompactView?: boolean
    changedLinesCount?: number
  }
): DiffFilterResult {
  const { alwaysShowLargeDiffs, isCompactView = false, changedLinesCount } = options
  const isGenerated = isGeneratedFile(filePath)
  const isLarge = isLargeDiff(lineCount, sizeBytes)
  const hasSmallChangeInCompactView = isSmallCompactChange(isLarge, isCompactView, changedLinesCount)
  const hasSmallRenderedFootprintInCompactView = isSmallCompactFootprint(isLarge, isCompactView, lineCount)

  if (!isGenerated && !isLarge) {
    return {
      isGenerated: false,
      isLarge: false,
      shouldCollapse: false
    }
  }

  const shouldCollapseForSize = shouldCollapseLargeDiff(
    isLarge,
    alwaysShowLargeDiffs,
    hasSmallChangeInCompactView,
    hasSmallRenderedFootprintInCompactView
  )
  const shouldCollapse = isGenerated || shouldCollapseForSize

  const reason = deriveCollapseReason(isGenerated, isLarge, shouldCollapseForSize)

  return {
    isGenerated,
    isLarge,
    shouldCollapse,
    reason,
    lineCount: isLarge ? lineCount : undefined,
    sizeBytes: isLarge ? sizeBytes : undefined
  }
}

function isSmallCompactChange(isLarge: boolean, isCompactView: boolean, changedLinesCount?: number) {
  return (
    isLarge &&
    isCompactView &&
    typeof changedLinesCount === 'number' &&
    changedLinesCount <= 50
  )
}

function isSmallCompactFootprint(isLarge: boolean, isCompactView: boolean, lineCount: number) {
  return (
    isLarge &&
    isCompactView &&
    lineCount > 0 &&
    lineCount <= COMPACT_VIEW_SAFE_LINE_THRESHOLD
  )
}

function shouldCollapseLargeDiff(
  isLarge: boolean,
  alwaysShowLargeDiffs: boolean,
  hasSmallChangeInCompactView: boolean,
  hasSmallRenderedFootprintInCompactView: boolean
) {
  return (
    isLarge &&
    !alwaysShowLargeDiffs &&
    !hasSmallChangeInCompactView &&
    !hasSmallRenderedFootprintInCompactView
  )
}

function deriveCollapseReason(
  isGenerated: boolean,
  isLarge: boolean,
  shouldCollapseForSize: boolean
): 'generated' | 'large' | 'both' | undefined {
  if (isGenerated && isLarge) return 'both'
  if (isGenerated) return 'generated'
  if (shouldCollapseForSize) return 'large'
  return undefined
}

export function formatDiffSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} bytes`
  } else if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`
  } else {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }
}
