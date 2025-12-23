import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { DiffResponse, SplitDiffResponse, LineInfo, SplitDiffResult, FileInfo } from '../../types/diff'
import type { CommitFileChange } from '../git-graph/types'
import type { ChangedFile } from '../../common/events'
import { logger } from '../../utils/logger'

export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'

export type ViewMode = 'unified' | 'split'

export interface FileDiffDataUnified {
  file: ChangedFile
  diffResult: LineInfo[]
  changedLinesCount: number
  fileInfo: FileInfo
  isBinary?: boolean
  unsupportedReason?: string
  totalLineCount?: number
}

export interface FileDiffDataSplit {
  file: ChangedFile
  splitDiffResult: SplitDiffResult
  changedLinesCount: number
  fileInfo: FileInfo
  isBinary?: boolean
  unsupportedReason?: string
  totalLineCount?: number
}

export type FileDiffData = FileDiffDataUnified | FileDiffDataSplit

export function normalizeCommitChangeType(changeType: string): ChangeType {
  switch (changeType) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'M':
      return 'modified'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'unknown'
  }
}

export interface CommitDiffRequest {
  repoPath: string
  commitHash: string
  file: CommitFileChange
}

export async function loadCommitFileDiff(request: CommitDiffRequest): Promise<FileDiffDataUnified> {
  const { repoPath, commitHash, file } = request
  const diffResponse = await invoke<DiffResponse>(TauriCommands.ComputeCommitUnifiedDiff, {
    repoPath,
    commitHash,
    filePath: file.path,
    oldFilePath: file.oldPath ?? null,
  })
  const changedLinesCount = diffResponse.stats.additions + diffResponse.stats.deletions
  return {
    file: {
      path: file.path,
      change_type: normalizeCommitChangeType(file.changeType),
      previous_path: file.oldPath,
      additions: diffResponse.stats.additions,
      deletions: diffResponse.stats.deletions,
      changes: changedLinesCount,
    },
    diffResult: diffResponse.lines,
    changedLinesCount,
    fileInfo: diffResponse.fileInfo,
    isBinary: diffResponse.isBinary,
    unsupportedReason: diffResponse.unsupportedReason,
    totalLineCount: diffResponse.lines.length,
  }
}


export async function loadFileDiff(
  sessionName: string | null,
  file: ChangedFile,
  viewMode: ViewMode
): Promise<FileDiffData> {
  if (viewMode === 'unified') {
    const diffResponse = await invoke<DiffResponse>(TauriCommands.ComputeUnifiedDiffBackend, {
      sessionName,
      filePath: file.path,
    })
    const changedLinesCount = diffResponse.stats.additions + diffResponse.stats.deletions
    return {
      file,
      diffResult: diffResponse.lines,
      changedLinesCount,
      fileInfo: diffResponse.fileInfo,
      isBinary: diffResponse.isBinary,
      unsupportedReason: diffResponse.unsupportedReason,
      totalLineCount: diffResponse.lines.length,
    }
  } else {
    const splitResponse = await invoke<SplitDiffResponse>(TauriCommands.ComputeSplitDiffBackend, {
      sessionName,
      filePath: file.path,
    })
    const changedLinesCount = splitResponse.stats.additions + splitResponse.stats.deletions
    return {
      file,
      splitDiffResult: splitResponse.splitResult,
      changedLinesCount,
      fileInfo: splitResponse.fileInfo,
      isBinary: splitResponse.isBinary,
      unsupportedReason: splitResponse.unsupportedReason,
      totalLineCount: Math.max(
        splitResponse.splitResult.leftLines.length,
        splitResponse.splitResult.rightLines.length
      ),
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
    } catch (e) {
      logger.debug(`Failed to load diff for ${file.path} in session ${sessionName}`, e)
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
