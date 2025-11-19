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
  const hasSmallChangeInCompactView =
    isLarge &&
    isCompactView &&
    typeof changedLinesCount === 'number' &&
    changedLinesCount <= 50

  if (!isGenerated && !isLarge) {
    return {
      isGenerated: false,
      isLarge: false,
      shouldCollapse: false
    }
  }

  const shouldCollapseForSize = isLarge && !alwaysShowLargeDiffs && !hasSmallChangeInCompactView
  const shouldCollapse = isGenerated || shouldCollapseForSize

  let reason: 'generated' | 'large' | 'both' | undefined
  if (isGenerated && isLarge) {
    reason = 'both'
  } else if (isGenerated) {
    reason = 'generated'
  } else if (shouldCollapseForSize) {
    reason = 'large'
  }

  return {
    isGenerated,
    isLarge,
    shouldCollapse,
    reason,
    lineCount: isLarge ? lineCount : undefined,
    sizeBytes: isLarge ? sizeBytes : undefined
  }
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
