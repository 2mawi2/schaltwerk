export interface LineInfo {
  content: string
  type: 'added' | 'removed' | 'unchanged'
  oldLineNumber?: number
  newLineNumber?: number
  isCollapsible?: boolean
  collapsedCount?: number
  collapsedLines?: LineInfo[]
}

export interface SplitDiffResult {
  leftLines: LineInfo[]
  rightLines: LineInfo[]
}

export interface DiffStats {
  additions: number
  deletions: number
}

export interface FileInfo {
  language?: string
  sizeBytes: number
}

export interface DiffResponse {
  lines: LineInfo[]
  stats: DiffStats
  fileInfo: FileInfo
  isLargeFile: boolean
  isBinary?: boolean
  unsupportedReason?: string
}

export interface SplitDiffResponse {
  splitResult: SplitDiffResult
  stats: DiffStats
  fileInfo: FileInfo
  isLargeFile: boolean
  isBinary?: boolean
  unsupportedReason?: string
}