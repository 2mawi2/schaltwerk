import { invoke } from '@tauri-apps/api/core'
import { DiffResponse, SplitDiffResponse, LineInfo, SplitDiffResult, FileInfo } from '../../types/diff'

export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'

export interface ChangedFile {
  path: string
  change_type: ChangeType
}

export type ViewMode = 'unified' | 'split'

export interface FileDiffDataUnified {
  file: ChangedFile
  mainContent: string
  worktreeContent: string
  diffResult: LineInfo[]
  changedLinesCount: number
  fileInfo: FileInfo
  isBinary?: boolean
  unsupportedReason?: string
}

export interface FileDiffDataSplit {
  file: ChangedFile
  mainContent: string
  worktreeContent: string
  splitDiffResult: SplitDiffResult
  changedLinesCount: number
  fileInfo: FileInfo
  isBinary?: boolean
  unsupportedReason?: string
}

export type FileDiffData = FileDiffDataUnified | FileDiffDataSplit

// Legacy helper functions - no longer used since we get stats from Rust backend

export async function loadFileDiff(
  sessionName: string | null,
  file: ChangedFile,
  viewMode: ViewMode
): Promise<FileDiffData> {
  // PERFORMANCE FIX: Only call the Rust backend once, it handles file loading internally
  // This eliminates the double file loading that was killing performance
  
  if (viewMode === 'unified') {
    const diffResponse = await invoke<DiffResponse>('compute_unified_diff_backend', {
      sessionName,
      filePath: file.path,
    })
    const changedLinesCount = diffResponse.stats.additions + diffResponse.stats.deletions
    return { 
      file, 
      mainContent: '', // No longer needed since diff computation happens in backend
      worktreeContent: '', // No longer needed since diff computation happens in backend
      diffResult: diffResponse.lines, 
      changedLinesCount,
      fileInfo: diffResponse.fileInfo,
      isBinary: diffResponse.isBinary,
      unsupportedReason: diffResponse.unsupportedReason
    }
  } else {
    const splitResponse = await invoke<SplitDiffResponse>('compute_split_diff_backend', {
      sessionName,
      filePath: file.path,
    })
    const changedLinesCount = splitResponse.stats.additions + splitResponse.stats.deletions
    return { 
      file, 
      mainContent: '', // No longer needed since diff computation happens in backend
      worktreeContent: '', // No longer needed since diff computation happens in backend
      splitDiffResult: splitResponse.splitResult, 
      changedLinesCount,
      fileInfo: splitResponse.fileInfo,
      isBinary: splitResponse.isBinary,
      unsupportedReason: splitResponse.unsupportedReason
    }
  }
}

export async function loadAllFileDiffs(
  sessionName: string | null,
  files: ChangedFile[],
  viewMode: ViewMode,
  concurrency = 4
): Promise<Map<string, FileDiffData>> {
  const results = new Map<string, FileDiffData>()
  let index = 0
  const inFlight: Promise<void>[] = []

  const runNext = async () => {
    const myIndex = index++
    if (myIndex >= files.length) return
    const file = files[myIndex]
    try {
      const diff = await loadFileDiff(sessionName, file, viewMode)
      results.set(file.path, diff)
    } catch (_e) {
      // Swallow per-file errors; caller can decide how to surface
      // Keep place so UI can skip missing entries
    }
    await runNext()
  }

  const workers = Math.min(concurrency, files.length)
  for (let i = 0; i < workers; i++) {
    inFlight.push(runNext())
  }
  await Promise.all(inFlight)
  return results
}
